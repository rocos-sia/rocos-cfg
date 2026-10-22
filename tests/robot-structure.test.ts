import { afterEach, expect, it } from 'vitest';
import { readRobot, editJoint } from '../src/core/documents/urdf';
import { urdfSourceRange } from '../src/core/documents/urdf-source';
import { robotStructure } from '../src/components/robotStructure';
import type { StructureNode } from '../src/components/RobotStructureTree';
import { editGeometry } from '../src/core/documents/urdf-geometry';
import { planRobotChange } from '../src/core/documents/robot-edit';
import { createProject } from '../src/core/project/create';
import { fileById, utf8 } from '../src/core/project/types';
import { setLocale } from '../src/i18n';
import { malformedRobot } from './fixtures/malformed-robot';

afterEach(() => setLocale('zh-CN'));
const flatten = (nodes: StructureNode[]): StructureNode[] => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
it('preserves every XML occurrence across orphans, duplicate/empty names, cycles and missing links', () => {
  const robot = readRobot(malformedRobot), result = robotStructure(robot), rows = flatten(result.nodes);
  expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  expect(result.targets.size).toBe(robot.links.length + robot.joints.length);
  for (const key of result.targets.keys()) expect(rows.filter(row => row.key === key)).toHaveLength(1);
  expect(rows.find(row => row.key === 'joint:orphan')?.children?.[0].key).toBe('link:arm');
  expect(rows.find(row => row.key === 'missing:2')?.title).toContain('歧义');
  expect(rows.find(row => row.key === 'missing:4')?.title).toContain('absent');
  expect(result.references.get('reference:3')).toBe('link:base_link');
  expect(rows.some(row => row.title.includes('opaque'))).toBe(false);
  expect(result.targets.get('conflict:joint:2')).toMatchObject({ kind: 'joint', index: 2, name: 'shared', ambiguous: true });
});
it('keeps valid tree identities and endpoint labels and places multiple roots in a conflict group', () => {
  const robot = readRobot('<robot name="r"><link name="a"/><link name="b"/><joint name="j" type="fixed"><parent link="a"/><child link="b"/></joint></robot>');
  const result = robotStructure(robot, ['b']);
  expect(flatten(result.nodes).map(n => n.key)).toEqual(['link:a', 'joint:j', 'link:b']);
  expect(flatten(result.nodes)[2].title).toBe('b [控制链端点]');
  expect([...result.targets.values()].some(n => n.ambiguous)).toBe(false);
  expect(robotStructure(readRobot('<robot name="r"><link name="a"/><link name="b"/></robot>')).nodes[0].key).toBe('unconnected');
});
it('keeps both incoming joints while showing the multiply-parented child once with a navigable reference', () => {
  const robot = readRobot('<robot name="r"><link name="a"/><link name="b"/><joint name="first" type="fixed"><parent link="a"/><child link="b"/></joint><joint name="second" type="fixed"><parent link="a"/><child link="b"/></joint></robot>');
  const result = robotStructure(robot), rows = flatten(result.nodes);
  expect(rows.map(n => n.key)).toEqual(['link:a', 'joint:first', 'link:b', 'joint:second', 'reference:1']);
  expect(result.references.get('reference:1')).toBe('link:b'); expect(result.targets.size).toBe(4);
  expect(robot.errors.join(' ')).toContain('多个父关节');
});
it('translates conflict labels without translating authored node names or changing identities', () => {
  const robot = readRobot(malformedRobot), chinese = robotStructure(robot); setLocale('en-US');
  const english = robotStructure(robot);
  expect([...english.targets]).toEqual([...chinese.targets]);
  expect(flatten(english.nodes).find(n => n.key === 'conflict:joint:2')?.title).toContain('shared [Joint #3, ambiguous or empty name]');
  expect(english.nodes[0].title).toBe('Disconnected / conflicting nodes');
});
it('locates direct XML occurrences rather than names, comments, nested hardware or transmission references', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const text = ['<robot name="r">', '<!-- <joint name="comment"/> -->', '<hardware><joint name="legacy"/></hardware>', '<link name="中文"/>', '<joint name="same" data="first"><parent link="中文"/><child link="中文"/></joint>', '<transmission><joint name="same"/></transmission>', '<joint name="same" data="second"><parent link="中文"/><child link="中文"/></joint>', '</robot>'].join(newline);
    const range = urdfSourceRange(text, 'joint', 1)!;
    expect(text.slice(range.from)).toMatch(/^<joint name="same" data="second"/);
    expect(text.slice(range.from, range.to)).toBe('<joint');
    expect(urdfSourceRange(text, 'joint', 2)).toBeUndefined(); expect(urdfSourceRange(text, 'link', -1)).toBeUndefined();
  }
  const text = '<u:robot xmlns:u="urn:test"><u:link name="a"/></u:robot>', range = urdfSourceRange(text, 'link', 0)!;
  expect(text.slice(range.from, range.to)).toBe('<u:link');
});
it('refuses ambiguous name-based mutations without altering the input project or XML', () => {
  expect(() => editJoint(malformedRobot, 'shared', 'xyz', '1 2 3')).toThrow('名称不唯一');
  expect(() => editGeometry(malformedRobot, 'dup', 'visual', 0, 'xyz', '1 2 3')).toThrow('名称不唯一');
  const project = createProject('invalid', 'igh'); fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(malformedRobot);
  const before = structuredClone(project);
  expect(() => planRobotChange(project, { kind: 'rename', node: 'joint', name: 'shared', value: 'changed' })).toThrow('名称不唯一');
  expect(() => planRobotChange(project, { kind: 'delete', node: 'link', name: 'dup', mode: 'subtree' })).toThrow('名称不唯一');
  expect(project).toEqual(before);
});
