import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project/create';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { planRobotChange, topologyErrors, changeJointParameter, changeLinkGeometry } from '../src/core/documents/robot-edit';
import { readRobot } from '../src/core/documents/urdf';
import { readYaml, patchYaml } from '../src/core/documents/yaml';
import { saveProject, openProject } from '../src/core/project/archive';

const fixture = `<?xml version="1.0"?><robot name="branch">
<!-- preserve model metadata -->
<link name="base"/><link name="arm"><visual><geometry><box size="1 2 3"/></geometry></visual></link><link name="tool"/><link name="sensor"/>
<joint name="shoulder" type="fixed"><parent link="base"/><child link="arm"/><origin xyz="0 0 1"/></joint>
<joint name="wrist" type="fixed"><parent link="arm"/><child link="tool"/></joint>
<joint name="sensor_mount" type="fixed"><parent link="base"/><child link="sensor"/><mimic joint="wrist"/></joint>
<transmission name="wrist_transmission"><joint name="wrist"><hardwareInterface>PositionJointInterface</hardwareInterface></joint></transmission>
<gazebo reference="arm"><material>Grey</material></gazebo>
<custom target="wrist" keep="yes"/>
</robot>`;
function project() {
  const p = createProject('branch', 'igh');
  fileById(p, p.entrypoints.urdf)!.bytes = utf8.encode(fixture);
  for (const [id, key, value] of [[p.entrypoints.app!, 'robot', { base_link: 'base', tip_link: 'tool' }], [p.entrypoints.hardware!, 'hardware', [{ id: 3, type: 'driver', joint_name: 'wrist' }]], [p.entrypoints.binding!, 'joint_bindings', [{ joint_name: 'wrist', drive_id: 3 }]]] as const) {
    const f = fileById(p, id)!; f.bytes = utf8.encode(patchYaml(textOf(f), [key], value));
  }
  p.editor.confirmations['drive:3'] = true;
  return p;
}
const robotText = (p: ReturnType<typeof project>) => textOf(fileById(p, p.entrypoints.urdf)!);
const config = (p: ReturnType<typeof project>, id: string | null) => readYaml(textOf(fileById(p, id)!));

describe('robot structure transactions', () => {
  it('renames joints and their known references, preserving unknown extensions and warnings in archives', async () => {
    const p = project(), plan = planRobotChange(p, { kind: 'rename', node: 'joint', name: 'wrist', value: 'tool_joint' });
    expect(robotText(p)).toBe(fixture);
    const text = robotText(plan.project);
    expect(text).toContain('mimic joint="tool_joint"');
    expect(text).toContain('<joint name="tool_joint"><hardwareInterface>');
    expect(text).toContain('<custom target="wrist" keep="yes"/>');
    expect(text).toContain('<!-- preserve model metadata -->');
    expect(config(plan.project, p.entrypoints.hardware).hardware[0].joint_name).toBe('tool_joint');
    expect(config(plan.project, p.entrypoints.binding).joint_bindings[0]).toEqual({ joint_name: 'tool_joint', drive_id: 3n });
    expect(plan.warnings.join(' ')).toContain('custom');
    const reopened = await openProject(await saveProject(plan.project));
    expect(reopened.editor.notices).toEqual(plan.project.editor.notices);
  });
  it('renames links, updates base/tip and preserves geometry and gazebo references', () => {
    const p = project();
    const arm = planRobotChange(p, { kind: 'rename', node: 'link', name: 'arm', value: 'forearm' }).project;
    expect(robotText(arm)).toContain('<gazebo reference="forearm">');
    expect(robotText(arm)).toContain('<box size="1 2 3"/>');
    expect(readRobot(robotText(arm)).joints.find(j => j.name === 'wrist')?.parent).toBe('forearm');
    const tip = planRobotChange(arm, { kind: 'rename', node: 'link', name: 'tool', value: 'tcp' }).project;
    expect(config(tip, p.entrypoints.app).robot.tip_link).toBe('tcp');
  });
  it('rejects duplicate names, cycles, multiple parents and removing the root atomically', () => {
    const p = project();
    expect(() => planRobotChange(p, { kind: 'rename', node: 'link', name: 'arm', value: 'base' })).toThrow('已存在');
    expect(() => planRobotChange(p, { kind: 'reparent', joint: 'shoulder', parent: 'tool' })).toThrow('环');
    expect(() => planRobotChange(p, { kind: 'rechild', joint: 'shoulder', child: 'sensor' })).toThrow('父关节');
    expect(() => planRobotChange(p, { kind: 'delete', node: 'link', name: 'base', mode: 'subtree' })).toThrow('根 Link');
    expect(robotText(p)).toBe(fixture);
  });
  it('reparents a subtree preserving local transforms, devices and original binding IDs', () => {
    const p = project(), next = planRobotChange(p, { kind: 'reparent', joint: 'shoulder', parent: 'sensor' }).project;
    const r = readRobot(robotText(next));
    expect(r.joints.find(j => j.name === 'shoulder')).toMatchObject({ parent: 'sensor', xyz: '0 0 1' });
    expect(topologyErrors(r)).toEqual([]);
    expect(config(next, p.entrypoints.binding).joint_bindings[0].drive_id).toBe(3n);
    expect(next.editor.confirmations).toEqual({});
  });
  it('cascades deletion with binding, mimic and transmission cleanup while keeping hardware devices', () => {
    const p = project(), next = planRobotChange(p, { kind: 'delete', node: 'joint', name: 'shoulder', mode: 'subtree' }).project;
    expect(readRobot(robotText(next)).links).toEqual(['base', 'sensor']);
    expect(config(next, p.entrypoints.app).robot.tip_link).toBe('base');
    expect(config(next, p.entrypoints.hardware).hardware[0]).toMatchObject({ id: 3n, joint_name: '' });
    expect(config(next, p.entrypoints.binding).joint_bindings).toEqual([]);
    expect(robotText(next)).not.toContain('<transmission');
    expect(robotText(next)).not.toContain('<mimic');
    expect(robotText(next)).toContain('<custom target="wrist" keep="yes"/>');
  });
  it('deletes one link while reattaching its descendants and rejects stale draft overwrites', () => {
    const p = project(), next = planRobotChange(p, { kind: 'delete', node: 'link', name: 'arm', mode: 'reattach' }).project;
    expect(readRobot(robotText(next)).joints.find(j => j.name === 'wrist')?.parent).toBe('base');
    expect(config(next, p.entrypoints.binding).joint_bindings).toHaveLength(1);
    p.editor.buffers[p.entrypoints.urdf!] = { text: '<broken', baseHash: 'a'.repeat(64) };
    expect(() => changeJointParameter(p, 'wrist', 'axis', '0 0 1')).toThrow('源码草稿');
    expect(() => planRobotChange(p, { kind: 'add', parent: 'base', joint: 'new', link: 'new_link' })).toThrow('源码草稿');
  });
});


it('edits a specific geometry without rebuilding other visuals, collision, material or inertia', () => {
  const p = project(), file = fileById(p, p.entrypoints.urdf)!;
  file.bytes = utf8.encode(`<robot name="g"><link name="base"><!-- keep --><visual name="first"><geometry><sphere radius="1"/></geometry><material name="paint"><color rgba="1 0 0 1"/></material></visual><visual name="second"><geometry><mesh filename="meshes/a.stl" scale="1 1 1"/></geometry></visual><collision><geometry><box size="1 2 3"/></geometry></collision><inertial><mass value="2"/><inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1"/></inertial></link></robot>`);
  changeLinkGeometry(p, 'base', 'visual', 1, 'filename', 'meshes/b.stl');
  changeLinkGeometry(p, 'base', 'visual', 1, 'xyz', '0 0 0.5');
  changeLinkGeometry(p, 'base', 'collision', 0, 'size', '2 3 4');
  expect(robotText(p)).toContain('sphere radius="1"');
  expect(robotText(p)).toContain('color rgba="1 0 0 1"');
  expect(robotText(p)).toContain('filename="meshes/b.stl"');
  expect(robotText(p)).toContain('xyz="0 0 0.5"');
  expect(robotText(p)).toContain('size="2 3 4"');
  expect(robotText(p)).toContain('mass value="2"');
  expect(robotText(p)).toContain('<!-- keep -->');
  expect(readRobot(robotText(p)).errors).toEqual([]);
  changeLinkGeometry(p, 'base', 'collision', 0, 'size', '0 3 4');
  expect(readRobot(robotText(p)).errors.join(' ')).toContain('size');
});
it('diagnoses invalid inertia and mimic cycles without treating them as a valid model', () => {
  const invalid = '<robot name="bad"><link name="base"><inertial><mass value="-1"/><inertia ixx="1" ixy="2" ixz="0" iyy="1" iyz="0" izz="1"/></inertial></link></robot>';
  expect(readRobot(invalid).errors.join(' ')).toContain('mass');
  expect(readRobot(invalid).errors.join(' ')).toContain('半正定');
  const cyclic = fixture.replace('<joint name="wrist" type="fixed">', '<joint name="wrist" type="fixed"><mimic joint="sensor_mount"/>');
  expect(readRobot(cyclic).errors.join(' ')).toContain('mimic 关系存在环');
});
