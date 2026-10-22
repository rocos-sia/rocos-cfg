import { expect, it } from 'vitest';
import { findUrdfMeshes, urdfMeshNames } from '../src/adapters/urdf-import';
import { prepareImport } from '../src/adapters/files';
import { applyImport } from '../src/core/project/import';
import { createProject } from '../src/core/project/create';
import { collectReferences } from '../src/core/project/references';
import { fileById, textOf } from '../src/core/project/types';
import { saveProject, openProject } from '../src/core/project/archive';
import { planSlaveChange } from '../src/core/bus/igh-edit';
import { readYaml } from '../src/core/documents/yaml';

const xml='<robot name="test"><link name="base"><visual><geometry><mesh filename="package://old/elsewhere/part%20one.stl"/></geometry></visual><collision><geometry><mesh filename="C:\\old\\other.stl"/></geometry></collision></link><hardware><mesh filename="ignored.stl"/></hardware></robot>';
function file(name:string, text:string, path?:string){const f=new File([text],name);if(path)Object.defineProperty(f,'webkitRelativePath',{value:path});return f;}
it('finds unique decoded mesh names and ignores legacy hardware',async()=>{
  expect(await urdfMeshNames(file('robot.urdf',xml))).toEqual(['part one.stl','other.stl']);
  await expect(urdfMeshNames(file('bad.urdf','<x/>'))).rejects.toThrow('robot');
});
it('searches only the exact containing folder, retaining duplicate candidates and missing names',async()=>{
  const urdf=file('robot.urdf',xml), names=await urdfMeshNames(urdf);
  const files=[file('robot.urdf',xml,'robot/robot.urdf'),file('part one.stl','a','robot/part one.stl'),file('part one.stl','b','robot/nested/part one.stl')];
  const found=await findUrdfMeshes(urdf,names,files);
  expect(found.map(g=>g.files.length)).toEqual([2,0]);
  await expect(findUrdfMeshes(urdf,names,[file('robot.urdf',xml,'parent/robot/robot.urdf')])).rejects.toThrow('同级目录');
  await expect(findUrdfMeshes(urdf,names,[file('robot.urdf',xml.replace('base','xxxx'),'robot/robot.urdf')])).rejects.toThrow('内容');
});
it('maps selected same-name meshes despite old paths, preserving URDF bytes and archive mappings',async()=>{
  const p=createProject('import','igh'),files=[file('robot.urdf',xml),file('part one.stl','mesh','robot/assets/part one.stl'),file('other.stl','mesh','robot/other.stl')];
  const plan=await prepareImport(p,files);plan.matchUrdfMeshes=true;
  const imported=applyImport(p,plan),restored=await openProject(await saveProject(imported));
  for(const project of [imported,restored]){
    const refs=collectReferences(project).filter(r=>r.sourceFileId===project.entrypoints.urdf);
    expect(refs.map(r=>[r.state,fileById(project,r.targetFileId)?.path])).toEqual([['internal','assets/part one.stl'],['internal','other.stl']]);
    expect(textOf(fileById(project,project.entrypoints.urdf)!)).toBe(xml);
  }
  expect(collectReferences(applyImport(p,{...plan,matchUrdfMeshes:false})).filter(r=>r.field.startsWith('mesh[')).every(r=>r.state==='missing')).toBe(true);
});
it('does not guess among duplicate basenames',async()=>{
  const p=createProject('import','igh'),plan=await prepareImport(p,[file('robot.urdf',xml),file('part one.stl','a','robot/a/part one.stl'),file('part one.stl','b','robot/b/part one.stl')]);
  plan.matchUrdfMeshes=true;
  expect(collectReferences(applyImport(p,plan)).find(r=>r.field==='mesh[0].filename')?.state).toBe('missing');
});
it('defaults only the first added slave to DC reference and preserves explicit off during subsequent additions',()=>{
  const config=(p:ReturnType<typeof createProject>)=>readYaml(textOf(fileById(p,p.entrypoints.master.fileId)!));
  const first=planSlaveChange(createProject('dc','igh'),{kind:'add'}).project;
  expect(config(first).slaves[0].dc_ref).toBe(true);
  const second=planSlaveChange(first,{kind:'add',preset:'drive-talon'}).project;
  expect(config(second).slaves.map((s:any)=>s.dc_ref)).toEqual([true,false]);
  expect(config(planSlaveChange(first,{kind:'copy',index:0}).project).slaves.map((s:any)=>s.dc_ref)).toEqual([true,false]);
  const moved=planSlaveChange(second,{kind:'down',index:0}).project;
  expect(config(moved).slaves.map((s:any)=>s.dc_ref)).toEqual([false,true]);
});
