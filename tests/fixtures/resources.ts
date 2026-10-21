import { createProject, makeFile } from '../../src/core/project/create';
import { fileById, textOf, utf8, type Project } from '../../src/core/project/types';
import { patchYaml } from '../../src/core/documents/yaml';
import { setPackagePath, mapReference } from '../../src/core/project/resources';
import { collectReferences } from '../../src/core/project/references';
function yaml(p: Project, id: string|null, path: (string|number)[], value: unknown) {
  const f = fileById(p,id)!; f.bytes=utf8.encode(patchYaml(textOf(f),path,value));
}
export function resourceProject() {
  const p=createProject('portable','igh');
  yaml(p,p.entrypoints.master.fileId,['slaves'],[{id:0,name:'Drive',rx_pdos:[{index:0x1600,entries:[{name:'control_word',index:0x6040,sub_index:0,bit_length:16},{name:'mode_of_operation',index:0x6060,sub_index:0,bit_length:8},{name:'target_position',index:0x607a,sub_index:0,bit_length:32}]}],tx_pdos:[{index:0x1a00,entries:[{name:'status_word',index:0x6041,sub_index:0,bit_length:16},{name:'position_actual_value',index:0x6064,sub_index:0,bit_length:32}]}]}]);
  fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode('<robot name="r"><link name="base"/><link name="tip"><visual><geometry><mesh filename="package://robot_description/meshes/part.dae"/></geometry></visual></link><joint name="joint" type="revolute"><parent link="base"/><child link="tip"/><limit lower="-1" upper="1" effort="10" velocity="1"/></joint></robot>');
  yaml(p,p.entrypoints.app,['robot','base_link'],'base');yaml(p,p.entrypoints.app,['robot','tip_link'],'tip');
  yaml(p,p.entrypoints.hardware,['hardware'],[{id:0,type:'driver',joint_name:'joint',transform:{ratio:1,cnt_per_unit:10000,torque_per_unit:1,offset_pos_cnt:0},limit:{lower:-1,upper:1,vel:1,acc:2,jerk:10,effort:10},inputs:{status_word:'status_word',position_actual_value:'position_actual_value'},outputs:{control_word:'control_word',mode_of_operation:'mode_of_operation',target_position:'target_position'}}]);
  yaml(p,p.entrypoints.binding,['joint_bindings'],[{joint_name:'joint',drive_id:0}]);p.editor.confirmations['drive:0']=true;
  p.files.push(makeFile('models/meshes/part.dae','resource','<?xml version="1.0"?><COLLADA><library_images><image id="paint"><init_from>../textures/blue%20paint.png</init_from></image></library_images><library_effects><effect><profile_COMMON><newparam><surface><init_from>paint</init_from></surface></newparam></profile_COMMON></effect></library_effects></COLLADA>'),
    {id:'paint',path:'models/textures/blue paint.png',role:'resource',owner:'resource',bytes:new Uint8Array([137,80,78,71])},
    makeFile('app/payload.yaml','attachment','# preserved payload\npayloads: []\n'),makeFile('scripts/start.lua','resource','return true'),makeFile('web/index.html','resource','<p>HMI</p>'),makeFile('web/static/style.css','resource','p{color:blue}'));
  setPackagePath(p,'robot_description','models');
  for(const ref of collectReferences(p).filter(r=>r.kind==='directory'))mapReference(p,ref,{directory:ref.field==='scripts'?'scripts':'web'});
  return p;
}
