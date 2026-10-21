import { expect, it } from 'vitest';
import { controlChain, editJoint, readRobot } from '../src/core/documents/urdf';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { bindingDocument, hardwareDocument } from '../src/core/hardware/schema';
import { planHardware } from '../src/core/hardware/edit';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { validateProject } from '../src/core/validation';
import { openProject, saveProject } from '../src/core/project/archive';
import { planRuntime } from '../src/core/export';
import { resourceProject } from './fixtures/resources';
const extension='<hardware><limit lower="-0.5" upper="0.75" vel="2" effort="5"/></hardware>';
const model=`<robot name="r"><link name="base"/><link name="tip"/><joint name="j" type="revolute"><parent link="base"/><child link="tip"/><limit lower="-1" upper="1" velocity="3" effort="10"/>${extension}</joint></robot>`;
it('edits standard limits while preserving opaque legacy hardware XML',()=>{
  const modified=editJoint(model,'j','upper','1.5'),joint=readRobot(modified).joints[0];
  expect(joint).toMatchObject({lower:'-1',upper:'1.5',velocity:'3',effort:'10'});
  expect(modified).toContain(extension);
});
it('ignores invalid legacy hardware values without changing control-chain validation',()=>{
  for(const legacy of [extension,'<hardware><limit lower="99" upper="-2" vel="typo"/><ethercat master="missing" slave="999"/></hardware>','<hardware><limit velocity="-10" effort="NaN"/></hardware>']){
    const input=model.replace(extension,legacy);
    expect(readRobot(input).errors).toEqual([]);
    expect(controlChain(input,'base','tip')).toEqual(controlChain(model.replace(extension,''),'base','tip'));
  }
  expect(readRobot(model.replace('velocity="3"','velocity="typo"')).errors).toContain('j velocity 必须为非负数');
});
it('keeps missing continuous limits empty even when legacy hardware provides limits',()=>{
  const input=model.replace('type="revolute"','type="continuous"').replace('<limit lower="-1" upper="1" velocity="3" effort="10"/>','');
  expect(readRobot(input).errors).toEqual([]);
  expect(controlChain(input,'base','tip')[0]).toMatchObject({lower:'',upper:'',velocity:'',effort:''});
  expect(readRobot(input.replace('name="r"','')).errors).toContain('URDF robot 缺少 name');
});
it('uses only explicit standard URDF limits for optional Hardware drafts',()=>{
  for(const continuous of [false,true]){
    const p=resourceProject(),urdf=fileById(p,p.entrypoints.urdf)!;
    let input=textOf(urdf).replace('</joint>',extension+'</joint>');
    if(continuous)input=input.replace('type="revolute"','type="continuous"').replace('<limit lower="-1" upper="1" effort="10" velocity="1"/>','');
    urdf.bytes=utf8.encode(input);
    editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.set('hardware',[]));editProjectYaml(p,p.entrypoints.binding!,doc=>doc.set('joint_bindings',[]));
    const plan=planHardware(p,{kind:'add',type:'driver',id:0,joint:'joint'}),hw=hardwareDocument(fileById(plan.project,p.entrypoints.hardware)!);
    expect(hw.devices[0].limit).toEqual({lower:continuous?null:-1,upper:continuous?null:1,vel:continuous?null:1,effort:continuous?null:10,acc:null,jerk:null});
    expect(hw.devices[0].transform.ratio).toBeNull();
  }
});
it('uses YAML hardware and bindings despite conflicting legacy XML and preserves files through archive and runtime export',async()=>{
  const p=resourceProject(),urdf=fileById(p,p.entrypoints.urdf)!,baseline=validateProject(p);
  const legacy='<hardware><id>999</id><ecat_id>unknown</ecat_id><limit lower="99" upper="-99" vel="bad"/><inputs><position_actual_value>missing</position_actual_value></inputs><mesh filename="missing.stl"/><texture filename="missing.png"/></hardware>';
  urdf.bytes=utf8.encode(textOf(urdf).replace('<robot name="r">','<robot name="r">'+legacy).replace('</joint>',legacy+'</joint>'));
  const hardware=textOf(fileById(p,p.entrypoints.hardware)!),binding=textOf(fileById(p,p.entrypoints.binding)!);
  expect(validateProject(p)).toEqual(baseline);
  const runtime=planRuntime(p),output=runtime.files.find(f=>f.fileId===urdf.id)!;
  const xml=new TextDecoder().decode(output.bytes);
  expect(xml.split(legacy)).toHaveLength(3);
  expect(xml).not.toContain('package://robot_description/meshes/part.dae');
  expect(xml).toContain('filename="meshes/part.dae"');
  const restored=await openProject(await saveProject(p));
  expect(textOf(fileById(restored,restored.entrypoints.urdf)!)).toBe(textOf(urdf));
  expect(textOf(fileById(restored,restored.entrypoints.hardware)!)).toBe(hardware);
  expect(textOf(fileById(restored,restored.entrypoints.binding)!)).toBe(binding);
  expect(hardwareDocument(fileById(restored,restored.entrypoints.hardware)!).devices[0].id).toBe(0);
  expect(bindingDocument(fileById(restored,restored.entrypoints.binding)!).bindings).toEqual([{joint_name:'joint',drive_id:0}]);
});
