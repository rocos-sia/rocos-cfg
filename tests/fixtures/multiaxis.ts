import { createExample } from '../../src/core/project/examples';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';
import { stringify } from 'yaml';
export const axisNames=['joint_1','joint_2_中文_{v0}','joint_3'];
export function multiaxisProject(){
  const p=createExample('igh');p.name='多设备键盘与模型回归';
  const master=fileById(p,p.entrypoints.master.fileId)!,hardware=fileById(p,p.entrypoints.hardware)!,binding=fileById(p,p.entrypoints.binding)!;
  const bus=readYaml(textOf(master)),hw=readYaml(textOf(hardware));
  bus.slaves=[0,4,2].map(id=>({...structuredClone(bus.slaves[0]),id,name:`Drive ${id}`}));master.bytes=utf8.encode(stringify(bus));
  hw.hardware=[4,0,2].map((id,i)=>{const d=structuredClone(hw.hardware[0]);d.id=id;d.joint_name=axisNames[i];d.transform.ratio=100+id;return d;});hardware.bytes=utf8.encode(stringify(hw));
  binding.bytes=utf8.encode(stringify({binding_policy:'explicit',joint_bindings:[4,0,2].map((id,i)=>({joint_name:axisNames[i],drive_id:id}))}));
  const links=['base_link','link_1','link_2','tool_link'];
  const visual='<visual><geometry><box size="0.12 0.06 0.06"/></geometry></visual>';
  const branch='branch_link_中文_很长的节点名称_0123456789';
  fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode('<robot name="multiaxis">'+links.map(name=>`<link name="${name}">${visual}</link>`).join('')+
    axisNames.map((name,i)=>`<joint name="${name}" type="revolute"><parent link="${links[i]}"/><child link="${links[i+1]}"/><origin xyz="0.15 0 0"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint>`).join('')+
    `<link name="${branch}">${visual}</link><joint name="fixed_branch" type="fixed"><parent link="base_link"/><child link="${branch}"/><origin xyz="0 0.2 0"/></joint></robot>`);
  p.editor.confirmations={'drive:0':true,'drive:4':true,'drive:2':true};return p;
}
