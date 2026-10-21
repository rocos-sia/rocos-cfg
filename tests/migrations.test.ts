import { describe, expect, it, vi } from 'vitest';
import { MigrationRegistry, type MigrationData, type MigrationSchema, type MigrationStep } from '../src/core/project/migrations';
import { digest, utf8 } from '../src/core/project/types';
import { inspectProjectArchive, saveProject } from '../src/core/project/archive';
import { createProject } from '../src/core/project/create';
import { packZip, unpackZip } from '../src/core/project/zip';

// Synthetic schema history, not a claim that ROCOS published schemas 2 or 3.
async function fixture(): Promise<MigrationData> {
  const bytes = utf8.encode('<EtherCATConfig><!-- exact ENI bytes --></EtherCATConfig>');
  return {manifest:{format:'test-only',formatVersion:1,projectSchemaVersion:1,oldName:'中文工程',
    files:[{id:'eni',path:'master/eni.xml',role:'eni',size:bytes.length,sha256:await digest(bytes)}],opaque:{futureOption:['保留',42]}},files:new Map([['master/eni.xml',bytes]])};
}
const schemas:MigrationSchema[]=[1,2,3].map(version=>({version,validate:async data=>{
  if(data.manifest.projectSchemaVersion!==version)throw new Error('wrong version');
  if(typeof data.manifest[version===1?'oldName':'name']!=='string')throw new Error('missing name');
  if(version===3&&!Array.isArray(data.manifest.notes))throw new Error('missing notes');
  for(const file of data.manifest.files){
    const bytes=data.files.get(file.path);
    if(!bytes||await digest(bytes)!==file.sha256||bytes.length!==file.size)throw new Error('payload integrity');
  }
}}));
const steps:MigrationStep[]=[
  {id:'test-name-1-2',from:1,to:2,description:'测试：更名元数据字段',transform:data=>{
    data.manifest.name=data.manifest.oldName;delete data.manifest.oldName;data.manifest.projectSchemaVersion=2;return data;
  }},
  {id:'test-notes-2-3',from:2,to:3,description:'测试：添加编辑备注',transform:data=>{
    data.manifest.notes=[];data.manifest.projectSchemaVersion=3;return data;
  }},
];

describe('staged project schema migrations',()=>{
  it('validates an adjacent chain, returns a deterministic report and preserves the source and opaque bytes',async()=>{
    const input=await fixture(),original=structuredClone(input),registry=new MigrationRegistry(3,schemas,steps);
    const result=await registry.prepare(input);
    expect(input).toEqual(original);expect(await registry.prepare(input)).toEqual(result);
    expect(result.data.manifest.name).toBe('中文工程');expect(result.data.manifest).not.toHaveProperty('oldName');
    expect(result.data.manifest.opaque).toEqual(input.manifest.opaque);
    expect(result.data.files.get('master/eni.xml')).toEqual(input.files.get('master/eni.xml'));
    expect(result.report).toMatchObject({from:1,to:3,steps:[{id:'test-name-1-2',changedPaths:[],manifestChanged:true},{id:'test-notes-2-3',changedPaths:[],manifestChanged:true}]});
    result.data.files.get('master/eni.xml')![0]=0;expect(input).toEqual(original);
  });
  it('does not mutate caller data when a later step fails after an earlier successful step',async()=>{
    const input=await fixture(),original=structuredClone(input);
    const bad={...steps[1],transform:(data:MigrationData)=>{data.files.get('master/eni.xml')![0]=0;throw new Error('injected failure');}};
    await expect(new MigrationRegistry(3,schemas,[steps[0],bad]).prepare(input)).rejects.toThrow(/test-notes-2-3.*injected failure/);
    expect(input).toEqual(original);
  });
  it('validates the source before running transforms and every output before continuing',async()=>{
    const input=await fixture(),transform=vi.fn(steps[0].transform);
    input.files.get('master/eni.xml')![0]=0;
    await expect(new MigrationRegistry(2,schemas.slice(0,2),[{...steps[0],transform}]).prepare(input)).rejects.toThrow('payload integrity');expect(transform).not.toHaveBeenCalled();
    const next=vi.fn(steps[1].transform);
    await expect(new MigrationRegistry(3,schemas,[{...steps[0],transform:data=>{data.manifest.projectSchemaVersion=2;return data;}},{...steps[1],transform:next}]).prepare(await fixture())).rejects.toThrow('missing name');
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects gaps, downgrades, duplicate steps and attempts to change the container contract',async()=>{
    const gap=new MigrationRegistry(3,schemas,[steps[1]]);
    expect(gap.supports(1)).toBe(false);expect(gap.supports(2)).toBe(true);expect(gap.supports(4)).toBe(false);expect(gap.supports(0)).toBe(false);
    await expect(gap.prepare(await fixture())).rejects.toThrow('迁移链');
    expect(()=>new MigrationRegistry(3,schemas,[steps[0],steps[0]])).toThrow('唯一');
    expect(()=>new MigrationRegistry(3,schemas,[{...steps[0],to:3}])).toThrow('相邻');
    expect(()=>new MigrationRegistry(3,schemas,[{...steps[1],from:3,to:2}])).toThrow();
    await expect(new MigrationRegistry(2,schemas.slice(0,2),[{...steps[0],transform:data=>{const next=steps[0].transform(data);next.manifest.formatVersion=2;return next;}}]).prepare(await fixture())).rejects.toThrow('容器契约');
  });
  it('refuses a freshly hashed replacement of ENI or removal of opaque payloads',async()=>{
    for(const role of ['eni','urdf','resource','vendor.optional']){
      const input=await fixture();input.manifest.files[0].role=role;
      const bytes=utf8.encode('replacement'),sha256=await digest(bytes);
      const replacement={...steps[0],transform:(data:MigrationData)=>{
        const next=steps[0].transform(data);next.files.set('master/eni.xml',bytes);next.manifest.files[0]={...next.manifest.files[0],size:bytes.length,sha256};return next;
      }};
      await expect(new MigrationRegistry(2,schemas.slice(0,2),[replacement]).prepare(input)).rejects.toThrow('不能删除或改写');
      const removal={...steps[0],transform:(data:MigrationData)=>{const next=steps[0].transform(data);next.manifest.files=[];next.files.clear();return next;}};
      await expect(new MigrationRegistry(2,schemas.slice(0,2),[removal]).prepare(input)).rejects.toThrow('不能删除或改写');
    }
  });
  it('reports changed editor state paths and validates the resulting index',async()=>{
    const input=await fixture(),bytes=utf8.encode('{}');input.files.set('state.json',bytes);
    input.manifest.files.push({id:'state',path:'state.json',role:'editor-state',size:bytes.length,sha256:await digest(bytes)});
    const nextBytes=utf8.encode('{"notes":[]}'),sha256=await digest(nextBytes);
    const registry=new MigrationRegistry(2,schemas.slice(0,2),[{...steps[0],transform:data=>{
      const next=steps[0].transform(data);next.files.set('state.json',nextBytes);Object.assign(next.manifest.files[1],{size:nextBytes.length,sha256});return next;
    }}]);
    expect((await registry.prepare(input)).report?.steps[0].changedPaths).toEqual(['state.json']);
    expect(input.files.get('state.json')).toEqual(bytes);
  });
  it('cannot relabel retained files or discard opaque module declarations while preserving their payload bytes',async()=>{
    const input=await fixture();input.manifest.modules=[{id:'vendor.future',version:9,required:false,fileIds:['eni'],vendor:{calibration:'原样保留'}}];
    for(const change of [(data:MigrationData)=>{data.manifest.files[0].role='attachment';},(data:MigrationData)=>{data.manifest.modules=[];},(data:MigrationData)=>{delete data.manifest.modules[0].vendor;}]){
      const transform=(data:MigrationData)=>{const next=steps[0].transform(data);change(next);return next;};
      await expect(new MigrationRegistry(2,schemas.slice(0,2),[{...steps[0],transform}]).prepare(input)).rejects.toThrow(/不能|模块契约/);
    }
    expect(input.manifest.modules[0].vendor.calibration).toBe('原样保留');
  });
  it('opens the actual first schema without a migration and preserves unsupported versions as exact original packages',async()=>{
    const bytes=await saveProject(createProject('current','igh'));
    const current=await inspectProjectArchive(bytes);expect(current.mode).toBe('editable');expect(current).not.toHaveProperty('migration');
    const entries=unpackZip(bytes),manifest=JSON.parse(new TextDecoder().decode(entries.get('rocos-project.json')));manifest.projectSchemaVersion=2;
    entries.set('rocos-project.json',utf8.encode(JSON.stringify(manifest)));const future=packZip(entries),original=new Uint8Array(future);
    const result=await inspectProjectArchive(future);expect(result.mode).toBe('readonly');if(result.mode==='readonly')expect(result.original).toEqual(original);
    expect(future).toEqual(original);
  });
});
