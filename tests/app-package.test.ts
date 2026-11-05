import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resourceProject } from './fixtures/resources';
import { createExample } from '../src/core/project/examples';
import { createProject, makeFile } from '../src/core/project/create';
import { createAppPackage } from '../src/core/documents/app-package';
import { appDocument, robotConfigFile } from '../src/core/documents/app-config';
import { readYaml } from '../src/core/documents/yaml';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { bindJoint, hardwareChain, planHardware } from '../src/core/hardware/edit';
import { hardwareDocument } from '../src/core/hardware/schema';
import { fileById, textOf, utf8, type Project } from '../src/core/project/types';
import { validateProject } from '../src/core/validation';
import { planRuntime } from '../src/core/export';
import { configure, enableSimulation, configuration, selectAppMaster, selectMaster } from '../src/core/project/configuration';
import { collectReferences } from '../src/core/project/references';
import { inspectImport, applyImport } from '../src/core/project/import';
import { openProject, saveProject } from '../src/core/project/archive';
import { planRobotChange } from '../src/core/documents/robot-edit';
import { readRobot, editJoint } from '../src/core/documents/urdf';
const errors=(p:Project)=>validateProject(p).filter(d=>d.severity==='error');
function nativeProject(){const p=resourceProject();createAppPackage(p);return p;}
function mimicProject(driven=false){
 const p=nativeProject(),file=fileById(p,p.entrypoints.urdf)!;
 file.bytes=utf8.encode(textOf(file).replace('</robot>','<link name="finger"/><joint name="follower" type="revolute"><parent link="tip"/><child link="finger"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="10" velocity="1"/><mimic joint="joint" multiplier="-1" offset="0.1"/></joint></robot>'));
 editProjectYaml(p,robotConfigFile(p)!.id,doc=>doc.set('tip_link','finger'));
 if(driven){configure(p).enabled.bus=false;editProjectYaml(p,p.entrypoints.hardware!,doc=>{const d=hardwareDocument(fileById(p,p.entrypoints.hardware)!).devices[0];doc.addIn(['hardware'],{...d,id:4,joint_name:'follower'});});p.editor.confirmations['drive:4']=true;}
 return p;
}
describe('current rocos-app configuration packages',()=>{
 it('generates schema 1 selectors and a robot-local hardware file without a binding sidecar',()=>{
  const p=createProject('new','igh'),app=readYaml(textOf(fileById(p,p.entrypoints.app)!)),robot=robotConfigFile(p)!;
  expect(app).toMatchObject({schema_version:1n,robot_config:'../robots/robot/robot.yaml',device_config:'../devices/robot_001/device.yaml',user_config:'user.yaml'});
  expect(app.robot).toBeUndefined();expect(p.entrypoints.binding).toBeNull();expect(p.files.some(f=>f.role==='binding')).toBe(false);
  expect(readYaml(textOf(robot))).toMatchObject({hardware_config:'hardware.yaml',urdf:'robot.urdf'});
  expect(fileById(p,p.entrypoints.hardware)?.path).toBe('robots/robot/hardware.yaml');
 });
 it('exports wrapped IgH parameters and direct joint_name bindings, then reimports the native package',async()=>{
  const p=nativeProject();expect(errors(p)).toEqual([]);
  const runtime=planRuntime(p),robot=robotConfigFile(p)!;
  expect(runtime.files.some(f=>f.path.includes('joint_binding'))).toBe(false);
  expect(readYaml(new TextDecoder().decode(runtime.files.find(f=>f.path===robot.path)!.bytes)).master_config).toBe('master.yaml');
  const master=readYaml(new TextDecoder().decode(runtime.files.find(f=>f.path==='robots/r/master.yaml')!.bytes));
  expect(master).toMatchObject({version:2n,master:{id:0n,cycle:1000n},slaves:[{id:0n,name:'Drive'}]});
  const plan=inspectImport(createProject('reimport','igh'),new Map(runtime.files.filter(f=>f.path!=='ROCOS-DEPLOYMENT.txt').map(f=>[f.path,f.bytes])));
  const imported=applyImport(createProjectClone(plan.projectId),plan); // Same project identity, fresh draft.
  expect(imported.entrypoints.binding).toBeNull();expect(fileById(imported,imported.entrypoints.hardware)?.path).toBe('robots/r/hardware.yaml');
  const reopened=await openProject(await saveProject(p));expect(errors(reopened)).toEqual([]);
  expect(appDocument(fileById(reopened,reopened.entrypoints.app)!,reopened).data.robot.tip_link).toBe('tip');
 });
 it('edits bindings in hardware, retaining comments, and updates model references without a binding file',()=>{
  const p=nativeProject(),hw=fileById(p,p.entrypoints.hardware)!;hw.bytes=utf8.encode('# shared hardware\n'+textOf(hw));
  bindJoint(p,'joint',undefined);expect(hardwareDocument(hw).devices[0].joint_name).toBe('');expect(errors(p).map(d=>d.code)).toContain('binding.missing');
  bindJoint(p,'joint',0);expect(textOf(hw)).toContain('# shared hardware');expect(errors(p)).toEqual([]);
  const renamed=planRobotChange(p,{kind:'rename',node:'joint',name:'joint',value:'drive_joint'}).project;
  expect(hardwareDocument(fileById(renamed,renamed.entrypoints.hardware)!).devices[0].joint_name).toBe('drive_joint');
  expect(errors(renamed)).toEqual([]);
  const chain=planRobotChange(renamed,{kind:'rename',node:'link',name:'tip',value:'tool'}).project;
  expect(readYaml(textOf(robotConfigFile(chain)!)).tip_link).toBe('tool');
  expect(planHardware(p,{kind:'delete',index:0}).project.entrypoints.binding).toBeNull();
 });
 it('updates the robot selector when switching APP PDO source and preserves mismatched drafts',()=>{
  const p=nativeProject();selectMaster(p,'ecm');selectAppMaster(p,'ecm');
  expect(readYaml(textOf(robotConfigFile(p)!))).toMatchObject({master_type:'ecm',master_config:'../../master/ecm.yaml'});
  p.editor.buffers[robotConfigFile(p)!.id]={text:'draft',baseHash:'base'};
  expect(()=>selectAppMaster(p,'igh')).toThrow('源码草稿');
 });
 it('reports malformed startup YAML without crashing and rejects the removed native binding selector',()=>{
  const p=nativeProject(),app=fileById(p,p.entrypoints.app)!;app.bytes=utf8.encode('invalid: [');
  expect(()=>errors(p)).not.toThrow();expect(errors(p).length).toBeGreaterThan(0);
  const valid=nativeProject();editProjectYaml(valid,robotConfigFile(valid)!.id,doc=>doc.set('joint_binding','joint_binding.yaml'));
  expect(errors(valid).some(d=>d.code==='app.robot.config')).toBe(true);
 });
 it('rejects duplicate hardware joint names and requires independent source bindings',()=>{
  const p=mimicProject(true);
  editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.setIn(['hardware',1,'joint_name'],'joint'));
  expect(errors(p).map(d=>d.code)).toContain('binding.name');
  editProjectYaml(p,p.entrypoints.hardware!,doc=>{doc.setIn(['hardware',1,'joint_name'],'follower');doc.setIn(['hardware',0,'joint_name'],'');});
  expect(errors(p).map(d=>d.code)).toContain('binding.missing');
 });
 it.each([false,true])('supports a mimic chain with driven=%s and rejects infeasible coupled limits',driven=>{
  const p=mimicProject(driven);expect(hardwareChain(p).map(j=>j.name)).toEqual(['joint','follower']);expect(errors(p)).toEqual([]);
  const model=fileById(p,p.entrypoints.urdf)!;model.bytes=utf8.encode(editJoint(textOf(model),'follower','mimicOffset','4'));
  expect(errors(p).map(d=>d.code)).toContain('binding.mimic-limits');
 });
 it('resolves multilevel mimic sources without requiring unrelated off-chain ancestors',()=>{
  const p=mimicProject(),model=fileById(p,p.entrypoints.urdf)!;
  model.bytes=utf8.encode(editJoint(textOf(model),'follower','mimic','intermediate').replace('</robot>','<link name="side"/><link name="other"/><joint name="unrelated" type="revolute"><parent link="base"/><child link="side"/><limit lower="-1" upper="1" effort="10" velocity="1"/></joint><joint name="intermediate" type="revolute"><parent link="side"/><child link="other"/><limit lower="-1" upper="1" effort="10" velocity="1"/><mimic joint="joint" multiplier="-2" offset="0.2"/></joint></robot>'));
  expect(hardwareChain(p).map(j=>j.name)).toEqual(['joint','follower']);expect(errors(p)).toEqual([]);
  model.bytes=utf8.encode(editJoint(textOf(model),'follower','mimicOffset','4'));
  expect(errors(p).map(d=>d.code)).toContain('binding.mimic-limits');
 });
 it('preserves and edits mimic coefficients, rejecting cycles and nonfinite values',()=>{
  const p=mimicProject(),model=fileById(p,p.entrypoints.urdf)!;
  expect(readRobot(textOf(model)).joints[1]).toMatchObject({mimic:'joint',mimicMultiplier:'-1',mimicOffset:'0.1'});
  const invalid=editJoint(textOf(model),'follower','mimicMultiplier','NaN');expect(readRobot(invalid).errors.length).toBeGreaterThan(0);
  const cycle=editJoint(textOf(model),'joint','mimic','follower');expect(readRobot(cycle).errors.some(e=>e.includes('环'))).toBe(true);
  expect(readRobot(editJoint(textOf(model),'follower','mimic','')).joints[1].mimic).toBe('');
 });
 it('shares hardware and meshes with MJCF includes and retains one hardware dependency after reopening',async()=>{
  const p=nativeProject();enableSimulation(p);const file=fileById(p,configuration(p).simulationFileId)!;
  expect(file.path).toBe('robots/r/mjcf/mujoco.yaml');expect(readYaml(textOf(file)).hardware_config).toBe('../hardware.yaml');
  const mesh=makeFile('robots/r/meshes/part.stl','resource','mesh');
  p.files.push(mesh,makeFile('robots/r/mjcf/scene.xml','mjcf','<mujoco><compiler meshdir="../meshes"/><include file="parts/assets.xml"/></mujoco>'),
   makeFile('robots/r/mjcf/parts/assets.xml','mjcf','<mujocoinclude><asset><mesh file="part.stl"/></asset></mujocoinclude>'));
  const reopened=await openProject(await saveProject(p)),refs=collectReferences(reopened);
  expect(refs.find(r=>r.sourceFileId===file.id&&r.field==='hardware_config')?.targetFileId).toBe(p.entrypoints.hardware);
  expect(refs.find(r=>r.sourceFileId===p.files.at(-1)!.id&&r.field==='mesh[0].file')).toMatchObject({state:'internal',targetFileId:mesh.id});
  expect(errors(reopened)).toEqual([]);expect(planRuntime(reopened).files.filter(f=>f.fileId===p.entrypoints.hardware)).toHaveLength(1);
 });
});
// Import plans are bound to a draft identity and revision.
function createProjectClone(id:string){const p=createProject('reimport','igh');p.id=id;return p;}

it.skipIf(!process.env.ROCOS_NATIVE_CONFIG_LOADER).each(['igh','ecm'] as const)('loads a relocated %s package with the current native AppConfig implementation',kind=>{
 const p=createExample(kind);createAppPackage(p);p.editor.confirmations['drive:0']=true;
 const root=mkdtempSync(join(tmpdir(),'rocos-native-'));
 try{
  for(const file of planRuntime(p).files){const path=join(root,file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.bytes);}
  const result=spawnSync(process.env.ROCOS_NATIVE_CONFIG_LOADER!,[join(root,'app/config.yaml')],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).robot.joint_binding).toBe('');
 }finally{rmSync(root,{recursive:true,force:true});}
});
