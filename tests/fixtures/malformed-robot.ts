export const malformedRobot = `<robot name="malformed">
<!-- all original nodes must remain inspectable -->
<link name="base_link"/><link name="arm"/><link name="dup"/>
<link name="dup"/><link name=""/><link name="tool_link"/>
<joint name="orphan" type="fixed"><parent link="ghost"/><child link="arm"/></joint>
<joint name="shared" type="fixed" occurrence="first"><parent link="base_link"/><child link="tool_link"/></joint>
<joint name="shared" type="fixed" occurrence="second"><parent link="arm"/><child link="dup"/></joint>
<joint name="cycle" type="fixed"><parent link="tool_link"/><child link="base_link"/></joint>
<joint name="missing_child" type="fixed"><parent link="base_link"/><child link="absent"/></joint>
<joint name="" type="fixed"><parent link="ghost"/><child link=""/></joint>
<hardware><link name="opaque-link"/><joint name="opaque-joint"/></hardware>
</robot>`;
