import type { RobotModel } from '../core/documents/urdf';
import { t } from '../i18n';
import type { StructureNode } from './RobotStructureTree';

export interface StructureTarget { kind: 'link' | 'joint'; index: number; name: string; ambiguous: boolean }

/** Each XML occurrence has its own identity, even when names cannot identify it. */
export function robotStructure(robot: RobotModel, endpoints: string[] = []) {
  const links = new Map<string, number[]>(), jointNames = new Map<string, number[]>();
  robot.links.forEach((name, i) => links.set(name, [...(links.get(name) || []), i]));
  robot.joints.forEach((joint, i) => jointNames.set(joint.name, [...(jointNames.get(joint.name) || []), i]));
  const targets = new Map<string, StructureTarget>(), references = new Map<string, string>();
  const linkKeys = robot.links.map((name, index) => register('link', name, index, links));
  const jointKeys = robot.joints.map((joint, index) => register('joint', joint.name, index, jointNames));
  function register(kind: 'link' | 'joint', name: string, index: number, names: Map<string, number[]>) {
    const ambiguous = !name.trim() || names.get(name)!.length !== 1;
    const key = ambiguous ? `conflict:${kind}:${index}` : `${kind}:${name}`;
    targets.set(key, { kind, index, name, ambiguous }); return key;
  }
  const uniqueLink = (name: string) => name.trim() && links.get(name)?.length === 1 ? links.get(name)![0] : undefined;
  const outgoing = new Map<number, number[]>();
  robot.joints.forEach((joint, i) => {
    const parent = uniqueLink(joint.parent);
    if (parent !== undefined) outgoing.set(parent, [...(outgoing.get(parent) || []), i]);
  });
  const seenLinks = new Set<number>(), seenJoints = new Set<number>();
  const pending: { index: number; node: StructureNode }[] = [];
  const title = (key: string) => {
    const target = targets.get(key)!;
    return target.ambiguous ? t('{name} [{kind} #{index}，名称冲突或为空]', { name: target.name || t('未命名'), kind: target.kind === 'link' ? 'Link' : 'Joint', index: target.index + 1 }) : target.name;
  };
  const linkNode = (index: number): StructureNode => {
    seenLinks.add(index);
    const key = linkKeys[index], node: StructureNode = { key, title: title(key) + (endpoints.includes(robot.links[index]) ? t(' [控制链端点]') : ''), children: [] };
    pending.push({ index, node }); return node;
  };
  const jointNode = (index: number): StructureNode => {
    seenJoints.add(index); const joint = robot.joints[index], child = uniqueLink(joint.child);
    let descendant: StructureNode;
    if (child === undefined) descendant = { key: `missing:${index}`, title: links.has(joint.child) ? t('子 Link 名称有歧义：{name}', { name: joint.child || t('未命名') }) : t('缺少子 Link：{name}', { name: joint.child || t('未提供') }), selectable: false };
    else if (seenLinks.has(child)) {
      descendant = { key: `reference:${index}`, title: t('{name} [重复父节点 / 环]', { name: joint.child }) };
      references.set(descendant.key, linkKeys[child]);
    } else descendant = linkNode(child);
    return { key: jointKeys[index], title: `${title(jointKeys[index])} [${joint.type}${joint.mimic ? ' · mimic' : ''}]`, children: [descendant] };
  };
  const drain = () => {
    while (pending.length) {
      const { index, node } = pending.pop()!;
      for (const joint of outgoing.get(index) || []) if (!seenJoints.has(joint)) node.children!.push(jointNode(joint));
    }
  };
  const nodes: StructureNode[] = [], conflicts: StructureNode[] = [];
  if (robot.roots.length === 1) {
    const root = uniqueLink(robot.roots[0]);
    if (root !== undefined) { nodes.push(linkNode(root)); drain(); }
  }
  // Orphan joints need their own row; do not invent a missing parent Link.
  robot.joints.forEach((joint, i) => {
    if (!seenJoints.has(i) && uniqueLink(joint.parent) === undefined) { conflicts.push(jointNode(i)); drain(); }
  });
  robot.links.forEach((_, i) => { if (!seenLinks.has(i)) { conflicts.push(linkNode(i)); drain(); } });
  robot.joints.forEach((_, i) => { if (!seenJoints.has(i)) { conflicts.push(jointNode(i)); drain(); } });
  if (conflicts.length) nodes.push({ key: 'unconnected', title: t('未连接节点 / 冲突节点'), selectable: false, children: conflicts });
  return { nodes, targets, references };
}
