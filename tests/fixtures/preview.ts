import { createExample } from '../../src/core/project/examples';
import { fileById, utf8 } from '../../src/core/project/types';

export function previewProject() {
  const project = createExample('igh');
  fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(`<robot name="display-test">
<link name="base_link"><visual><geometry><box size="0.1 0.1 0.05"/></geometry></visual></link>
<link name="visual_arm"><visual><origin xyz="0.5 -0.3 0"/><geometry><box size="1 0.1 0.1"/></geometry><material name="blue"><color rgba="0.1 0.3 0.8 1"/></material></visual></link>
<link name="collision_only"><collision><origin xyz="0.5 0 0"/><geometry><box size="0.8 0.2 0.2"/></geometry></collision></link>
<joint name="joint_1" type="revolute"><parent link="base_link"/><child link="visual_arm"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint>
<joint name="collision_mount" type="fixed"><parent link="base_link"/><child link="collision_only"/><origin xyz="0 0 0.1"/></joint>
</robot>`);
  return project;
}
