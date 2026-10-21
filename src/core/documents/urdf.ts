import { m as msg, MessageError, joinMessages, type DiagnosticMessage } from '../project/messages';
import { appRules } from '../project/profiles';
import { geometryDiagnostics } from './urdf-geometry';
import { child, children, xmlDocument, serializeXml } from './xml';
export interface RobotJointParameters { name: string; type: string; parent: string; child: string; xyz: string; rpy: string; axis: string; lower: string; upper: string; velocity: string; effort: string; mimic: string }
export type RobotJoint = RobotJointParameters;
export function readRobot(text: string) {
  const doc = xmlDocument(text); const root = doc.documentElement;
  if (root.localName !== 'robot') throw new MessageError(msg("URDF 根节点必须为 robot"));
  const links = children(root,'link').map(l => l.getAttribute('name') || '');
  const jointNodes=children(root,'joint');
  const joints: RobotJoint[] = jointNodes.map(j => ({ name: j.getAttribute('name') || '', type: j.getAttribute('type') || '', parent: child(j,'parent')?.getAttribute('link') || '', child: child(j,'child')?.getAttribute('link') || '', xyz: child(j,'origin')?.getAttribute('xyz') || '0 0 0', rpy: child(j,'origin')?.getAttribute('rpy') || '0 0 0', axis: child(j,'axis')?.getAttribute('xyz') || '1 0 0', lower: child(j,'limit')?.getAttribute('lower') || '', upper: child(j,'limit')?.getAttribute('upper') || '', velocity: child(j,'limit')?.getAttribute('velocity') || '', effort: child(j,'limit')?.getAttribute('effort') || '', mimic: child(j,'mimic')?.getAttribute('joint') || '' }));
  const issues: DiagnosticMessage[] = [];
  if(!root.getAttribute('name'))issues.push(msg("URDF robot 缺少 name"));
  if (new Set(links).size !== links.length || links.includes('')) issues.push(msg("Link 名称重复或为空"));
  if (new Set(joints.map(j=>j.name)).size !== joints.length || joints.some(j=>!j.name)) issues.push(msg("Joint 名称重复或为空"));
  const parents = new Set<string>();
  for (const [index,j] of joints.entries()) {
    const limit=child(jointNodes[index],'limit');
    if (!links.includes(j.parent) || !links.includes(j.child)) issues.push(msg("{v0} 的父/子 Link 不存在", {v0:String(j.name)}));
    if (parents.has(j.child)) issues.push(msg("{v0} 存在多个父关节", {v0:String(j.child)})); parents.add(j.child);
    if (!['fixed','revolute','continuous','prismatic','floating','planar'].includes(j.type)) issues.push(msg("{v0} 关节类型无效", {v0:String(j.name)}));
    for (const [label,value] of [['xyz',j.xyz],['rpy',j.rpy],['axis',j.axis]]) {
      const v = value.trim().split(/\s+/).map(Number); if (v.length !== 3 || v.some(n=>!Number.isFinite(n))) issues.push(msg("{v0} {v1} 需要三个有效数值", {v0:String(j.name), v1:String(label)}));
      if (label === 'axis' && j.type !== 'fixed' && v.every(n=>n===0)) issues.push(msg("{v0} 轴向不能为零", {v0:String(j.name)}));
    }
    if (['revolute','prismatic'].includes(j.type)||j.type==='continuous'&&limit) for (const key of ['velocity','effort'] as const) if (!j[key].trim() || !Number.isFinite(Number(j[key])) || Number(j[key]) < 0) issues.push(msg("{v0} {v1} 必须为非负数", {v0:String(j.name), v1:String(key)}));
    if (j.mimic && (!joints.some(target => target.name === j.mimic) || j.mimic === j.name)) issues.push(msg("{v0} 的 mimic 目标无效", {v0:String(j.name)}));
    if (['revolute','prismatic'].includes(j.type) && (!j.lower || !j.upper || !Number.isFinite(Number(j.lower)) || !Number.isFinite(Number(j.upper)) || Number(j.lower)>Number(j.upper))) issues.push(msg("{v0} 位置限位无效", {v0:String(j.name)}));
  }
  // Legacy <hardware> is opaque XML. Hardware YAML and explicit bindings own hardware configuration.
  for (const joint of joints) { const seen = new Set<string>(); let cursor: RobotJoint | undefined = joint; while (cursor?.mimic) { if (seen.has(cursor.name)) { issues.push(msg("mimic 关系存在环：{v0}", {v0:String(joint.name)})); break; } seen.add(cursor.name); cursor = joints.find(j => j.name === cursor!.mimic); } }
  const roots = links.filter(l => !parents.has(l));
  if (roots.length !== 1) issues.push(msg("URDF 必须恰有一个根 Link"));
  const visited = new Set<string>(), visiting = new Set<string>();
  function walk(link: string) { if (visiting.has(link)) { issues.push(msg("结构存在环：{v0}", {v0:String(link)})); return; } if (visited.has(link)) return; visiting.add(link); for(const j of joints.filter(j=>j.parent===link)) walk(j.child); visiting.delete(link); visited.add(link); }
  links.forEach(walk);
  issues.push(...geometryDiagnostics(text, [...new Set(links)], doc));
  return { doc, name: root.getAttribute('name') || '', links, joints, roots, errors:issues.map(issue=>issue.message), issues };
}
export type RobotModel = Omit<ReturnType<typeof readRobot>, 'doc'>;
export function controlChainFromRobot(robot:RobotModel, base:string, tip:string) {
  if (robot.errors.length) throw new MessageError(joinMessages(robot.issues));
  const chain: RobotJoint[] = []; let current = tip;
  if (!robot.links.includes(base) || !robot.links.includes(tip)) throw new MessageError(msg("Base/Tip 不存在"));
  while(current !== base) { const joint = robot.joints.find(j=>j.child===current); if (!joint) throw new MessageError(msg("Base 到 Tip 之间没有有向链")); chain.unshift(joint); current = joint.parent; }
  if (chain.some(j=>j.mimic || j.type!=='fixed'&&!appRules.controlledJointTypes.includes(j.type))) throw new MessageError(msg("当前 APP profile 未验证 mimic/floating/planar 控制链"));
  return chain.filter(j=>j.type!=='fixed');
}
export function controlChain(text: string, base: string, tip: string) {
  return controlChainFromRobot(readRobot(text),base,tip);
}
export function editJoint(text: string, name: string, field: keyof RobotJointParameters, value: string): string {
  const robot = readRobot(text), node = children(robot.doc.documentElement,'joint').find(j=>j.getAttribute('name')===name);
  if (!node) throw new MessageError(msg("关节不存在"));
  if (field === 'name' || field === 'type') node.setAttribute(field,value);
  else {
    const map: Record<string,[string,string]> = { parent:['parent','link'], child:['child','link'], xyz:['origin','xyz'],rpy:['origin','rpy'],axis:['axis','xyz'],lower:['limit','lower'],upper:['limit','upper'],velocity:['limit','velocity'],effort:['limit','effort'],mimic:['mimic','joint'] };
    const [tag,attr] = map[field]; let n = child(node,tag); if (!n) { n = robot.doc.createElement(tag); node.appendChild(n); } n.setAttribute(attr,value);
  }
  return serializeXml(robot.doc);
}
export function addJoint(text: string, parent: string, jointName: string, linkName: string) {
  const r = readRobot(text); if (r.links.includes(linkName) || r.joints.some(j=>j.name===jointName)) throw new MessageError(msg("节点名称已存在"));
  if (!r.links.includes(parent)) throw new MessageError(msg("父 Link 不存在"));
  const link = r.doc.createElement('link'); link.setAttribute('name',linkName); r.doc.documentElement.appendChild(link);
  const joint = r.doc.createElement('joint'); joint.setAttribute('name',jointName); joint.setAttribute('type','fixed');
  for(const [tag,value] of [['parent',parent],['child',linkName]]) { const n=r.doc.createElement(tag);n.setAttribute('link',value);joint.appendChild(n); }
  r.doc.documentElement.appendChild(joint); return serializeXml(r.doc);
}
