import { attachProfile, baseTarget } from '../src/core/project/profiles';
import { describe, expect, it } from 'vitest';
import { createProject, makeFile } from '../src/core/project/create';
import { collectReferences, activeFileIds } from '../src/core/project/references';
import { mapReference, moveResource, setPackagePath, resourceResolver } from '../src/core/project/resources';
import { fileById, textOf, utf8, digest, type Project } from '../src/core/project/types';
import { patchYaml, readYaml } from '../src/core/documents/yaml';
import { planRuntime, exportRuntime } from '../src/core/export';
import { unpackZip } from '../src/core/project/zip';
import { openProject, saveProject } from '../src/core/project/archive';
import { relativePath, resourcePath } from '../src/core/project/paths';
import { importFiles } from '../src/adapters/files';
import { validateProject } from '../src/core/validation';

import { resourceProject } from './fixtures/resources';
function yaml(p: Project, id: string|null, path: (string|number)[], value: unknown) { const f=fileById(p,id)!; f.bytes=utf8.encode(patchYaml(textOf(f),path,value)); }

describe('resource mapping and portable runtime export',()=>{
  it('keeps stable URDF reference identities and resolves indirect DAE textures',()=>{
    const p=resourceProject(), before=collectReferences(p);
    const mesh=before.find(r=>r.field==='mesh[0].filename')!;
    expect(mesh.state).toBe('internal');
    const texture=before.find(r=>r.field==='image[0].init_from[0]')!;
    expect(texture.targetFileId).toBe('paint');
    expect(before.some(r=>r.original==='paint')).toBe(false);
    yaml(p,p.entrypoints.app,['robot','payload'],'');
    expect(collectReferences(p).find(r=>r.sourceFileId===mesh.sourceFileId&&r.original===mesh.original)?.field).toBe(mesh.field);
    expect(resourceResolver(p)(texture.sourceFileId,texture.original)?.id).toBe('paint');
  });
  it('exports only the dependency closure, rewrites relative paths and leaves the project bytes unchanged',()=>{
    const p=resourceProject();p.files.push(makeFile('unused/broken.urdf','urdf','<invalid'),makeFile('private-notes.txt','attachment','not part of runtime'));
    const original=p.files.map(f=>[f.id,new Uint8Array(f.bytes)]);
    expect(validateProject(p).filter(d=>d.severity==='error')).toEqual([]);
    const plan=planRuntime(p), files=unpackZip(exportRuntime(p));
    expect(files.has('unused/broken.urdf')).toBe(false);expect(files.has('private-notes.txt')).toBe(false);
    expect(files.has('web/static/style.css')).toBe(true);expect(files.has('models/textures/blue paint.png')).toBe(true);
    expect(new TextDecoder().decode(files.get('models/robot.urdf'))).toContain('filename="meshes/part.dae"');
    expect(readYaml(new TextDecoder().decode(files.get('app/config.yaml'))).scripts).toBe('../scripts');
    expect(plan.rewrites.some(r=>r.field==='mesh[0].filename')).toBe(true);
    expect(p.files.map(f=>[f.id,f.bytes])).toEqual(original);
  });
  it('retains explicit mappings across file relocation and archive reopening',async()=>{
    const p=resourceProject();moveResource(p,'paint','assets/颜色.png');
    const saved=await openProject(await saveProject(p));
    expect(collectReferences(saved).find(r=>r.field==='image[0].init_from[0]')?.targetFileId).toBe('paint');
    expect(collectReferences(saved).find(r=>r.field==='scripts')?.targetPath).toBe('scripts');
    const files=unpackZip(exportRuntime(saved));
    expect(new TextDecoder().decode(files.get('models/meshes/part.dae'))).toContain('../../assets/%E9%A2%9C%E8%89%B2.png');
    expect(files.get('assets/颜色.png')).toEqual(new Uint8Array([137,80,78,71]));
  });
  it('blocks missing and mismatched core dependencies and records confirmed external resources',()=>{
    const p=resourceProject();p.files=p.files.filter(f=>f.id!=='paint');
    expect(()=>exportRuntime(p)).toThrow('错误');
    const texture=collectReferences(p).find(r=>r.field==='image[0].init_from[0]')!;
    mapReference(p,texture,{external:true});
    const plan=planRuntime(p);expect(plan.external.map(r=>r.original)).toContain('../textures/blue%20paint.png');
    expect(new TextDecoder().decode(plan.files.find(f=>f.path==='ROCOS-DEPLOYMENT.txt')!.bytes)).toContain('目标环境提供');
    const core=collectReferences(p).find(r=>r.field==='robot.urdf')!;
    expect(()=>mapReference(p,core,{external:true})).toThrow('核心配置');
    expect(()=>mapReference(p,core,{fileId:p.entrypoints.hardware!})).toThrow('urdf');
  });
  it('retains raw ENI bytes with UTF-16 encoding and generates ecm.yaml with the mapped ENI path',async()=>{
    const p=resourceProject();const master=makeFile('controller/config.yaml','ecm','id: 0\neni: /old/eni.xml\n');p.files.push(master);p.entrypoints.master={kind:'ecm',fileId:master.id,eniFileId:null};p.targets.master=baseTarget('ecm');attachProfile(p,'master');
    const vars=(items:[string,string,number,number][],group:string)=>items.map(([name,type,bits,offset])=>`<Variable><Name>Drive.${group}.${name}</Name><DataType>${type}</DataType><BitSize>${bits}</BitSize><BitOffs>${offset}</BitOffs></Variable>`).join('');
    const xml=`<?xml version="1.0" encoding="UTF-16"?><EtherCATConfig Version="1.3"><Config><Slave><Info><Name>Drive</Name><PhysAddr>1001</PhysAddr></Info><ProcessData><Send><BitStart>0</BitStart><BitLength>56</BitLength></Send><Recv><BitStart>0</BitStart><BitLength>48</BitLength></Recv></ProcessData></Slave><ProcessImage><Inputs><ByteSize>6</ByteSize>${vars([['status_word','UINT',16,0],['position_actual_value','DINT',32,16]],'Inputs')}</Inputs><Outputs><ByteSize>7</ByteSize>${vars([['control_word','UINT',16,0],['mode_of_operation','SINT',8,16],['target_position','DINT',32,24]],'Outputs')}</Outputs></ProcessImage></Config></EtherCATConfig>`;
    const bytes=new Uint8Array(Buffer.concat([Buffer.from([255,254]),Buffer.from(xml,'utf16le')]));
    const imported=await importFiles(p,[new File([bytes],'network.xml')]);
    const eni=fileById(imported,imported.entrypoints.master.eniFileId)!;expect(eni.encoding).toBe('utf-16le');
    mapReference(imported,collectReferences(imported).find(r=>r.field==='eni')!,{fileId:eni.id});
    expect(imported.editor.confirmations).toEqual({});
    imported.editor.confirmations['drive:0']=true;
    const output=unpackZip(exportRuntime(imported));
    expect(await digest(output.get(eni.path)!)).toBe(await digest(bytes));
    expect(output.has('controller/ecm.yaml')).toBe(true);expect(output.has('master/igh.yaml')).toBe(false);
    expect(readYaml(new TextDecoder().decode(output.get('controller/ecm.yaml'))).eni).toBe('../master/network.xml');
  });
  it('rejects collisions and escapes and does not silently overwrite duplicate import paths',async()=>{
    const p=resourceProject();expect(()=>moveResource(p,'paint','../outside.png')).toThrow('非法');
    expect(()=>moveResource(structuredClone(p),'paint','app/config.yaml')).toThrow('冲突');
    await expect(importFiles(p,[new File(['a'],'same.txt'),new File(['b'],'same.txt')])).rejects.toThrow('重复');
    expect(relativePath('app/config.yaml','models/robot.urdf')).toBe('../models/robot.urdf');
    expect(resourcePath('models/robot.urdf','%2e%2e/%2e%2e/private',{},true)).toBeUndefined();
    expect(()=>setPackagePath(p,'__proto__','models')).toThrow('Package');
  });
});
