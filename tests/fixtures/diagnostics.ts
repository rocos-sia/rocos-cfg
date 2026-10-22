import { createExample } from '../../src/core/project/examples';
import { fileById, utf8 } from '../../src/core/project/types';

export function missingPreviewProject() {
  const project = createExample('igh');
  fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(`<robot name="missing">
<hardware><mesh filename="opaque-root.stl"/></hardware><link name="base_link"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
<link name="tool_link"><visual><origin xyz="0.3 0 0"/><geometry><mesh filename="missing-a.stl" scale="0.001 0.001 0.001"/></geometry></visual>
<visual><origin xyz="0.6 0 0"/><geometry><mesh filename="missing-b.dae" scale="1000 1000 1000"/></geometry></visual>
<visual><origin xyz="0.9 0 0"/><geometry><mesh filename="https://example.invalid/remote.stl"/></geometry></visual>
<collision><origin xyz="0.3 0 0"/><geometry><mesh filename="missing-a.stl" scale="0.001 0.001 0.001"/></geometry></collision>
<hardware><mesh filename="opaque-link.stl"/></hardware></link>
<joint name="joint_1" type="fixed"><parent link="base_link"/><child link="tool_link"/></joint></robot>`);
  return project;
}

export function axisPreviewProject() {
  const project = createExample('igh');
  fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(`<robot name="axis"><link name="base_link"/>
<link name="arm"><visual><geometry><box size="0.3 0.3 0.1"/></geometry><material name="blue"><color rgba="0.1 0.3 0.8 1"/></material></visual></link>
<link name="tool_link"><visual><origin xyz="0.25 0 0"/><geometry><box size="0.5 0.1 0.1"/></geometry><material name="blue"/></visual></link>
<joint name="mount" type="fixed"><parent link="base_link"/><child link="arm"/><origin xyz="0.1 0 0" rpy="0 0 1.5707963267948966"/></joint>
<joint name="joint_1" type="revolute"><parent link="arm"/><child link="tool_link"/><origin xyz="0 0 0.15"/><axis xyz=" 1 0 0 "/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint></robot>`);
  return project;
}
