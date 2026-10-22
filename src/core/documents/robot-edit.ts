import { m as msg, MessageError, joinMessages, type DiagnosticMessage } from '../project/messages';
import { editGeometry, type GeometryView } from './urdf-geometry';
import { isMap, isSeq, type Document } from 'yaml';
import { readRobot, controlChain, addJoint, editJoint, type RobotJointParameters } from './urdf';
import { child, children, serializeXml, isLegacyHardware } from './xml';
import { appDocument } from './app-config';
import { editProjectYaml } from '../bus/igh-edit';
import { fileById, textOf, utf8, type Project } from '../project/types';

type NodeKind = 'link' | 'joint';
export type RobotAction =
  | { kind: 'rename'; node: NodeKind; name: string; value: string }
  | { kind: 'add'; parent: string; joint: string; link: string }
  | { kind: 'reparent'; joint: string; parent: string }
  | { kind: 'rechild'; joint: string; child: string }
  | { kind: 'delete'; node: NodeKind; name: string; mode: 'subtree' | 'reattach' }
  | { kind: 'chain'; base: string; tip: string };
export interface RobotPlan { project: Project; impacts: string[]; impactMessages: DiagnosticMessage[]; warnings: string[]; warningMessages: DiagnosticMessage[]; selection: string }

export function topologyDiagnostics(robot: ReturnType<typeof readRobot>): DiagnosticMessage[] {
  const errors: DiagnosticMessage[] = [], parents = new Map<string, string>();
  if (new Set(robot.links).size !== robot.links.length || robot.links.some(n => !n.trim())) errors.push(msg("Link 名称重复或为空"));
  if (new Set(robot.joints.map(j => j.name)).size !== robot.joints.length || robot.joints.some(j => !j.name.trim())) errors.push(msg("Joint 名称重复或为空"));
  for (const j of robot.joints) {
    if (!robot.links.includes(j.parent) || !robot.links.includes(j.child)) errors.push(msg("{v0} 引用了不存在的 Link", {v0:String(j.name)}));
    if (parents.has(j.child)) errors.push(msg("{v0} 存在多个父关节", {v0:String(j.child)}));
    parents.set(j.child, j.parent);
  }
  if (robot.links.filter(l => !parents.has(l)).length !== 1) errors.push(msg("URDF 必须恰有一个根 Link"));
  for (const link of robot.links) {
    const seen = new Set<string>(); let current: string | undefined = link;
    while (current !== undefined) {
      if (seen.has(current)) { errors.push(msg("结构存在环：{v0}", {v0:String(current)})); break; }
      seen.add(current); current = parents.get(current);
    }
  }
  return [...new Map(errors.map(issue=>[issue.message,issue])).values()];
}
function editable(p: Project, id: string | null) {
  const file = fileById(p, id);
  if (!file) throw new MessageError(msg("缺少需要更新的配置文件"));
  if (p.editor.buffers[file.id]) throw new MessageError(msg("请先应用或放弃 {v0} 的源码草稿", {v0:String(file.path)}));
  return file;
}
function editYaml(p: Project, id: string | null, edit: (doc: Document) => void) {
  const f = editable(p, id); editProjectYaml(p,f.id,edit);
}
function writeRobot(p: Project, text: string) {
  const f = editable(p, p.entrypoints.urdf);
  f.bytes = utf8.encode(text.replace(/(<\?xml\b[^?]*\bencoding\s*=\s*)["'][^"']+["']/i, '$1"UTF-8"'));
  f.encoding = 'utf-8';
}
export function changeJointParameter(p: Project, name: string, field: keyof RobotJointParameters, value: string) {
  if (['name', 'parent', 'child'].includes(field)) throw new MessageError(msg("结构变更请使用模型操作"));
  const f = editable(p, p.entrypoints.urdf); writeRobot(p, editJoint(textOf(f), name, field, value));
}
function chainLabel(p: Project) {
  try {
    const a = appDocument(fileById(p, p.entrypoints.app)!).data;
    const joints=controlChain(textOf(fileById(p, p.entrypoints.urdf)!), a.robot.base_link, a.robot.tip_link).map(j => j.name).join(' → ');
    return joints?msg('{joints}',{joints}):msg('无可动关节');
  } catch { return msg('尚未形成有效控制链'); }
}
export function planRobotChange(project: Project, action: RobotAction): RobotPlan {
  const p = structuredClone(project), impacts: DiagnosticMessage[] = [], warnings: DiagnosticMessage[] = [];
  const f = editable(p, p.entrypoints.urdf), robot = readRobot(textOf(f)), root = robot.doc.documentElement;
  if (action.kind === 'rename' || action.kind === 'delete') {
    const names = action.node === 'link' ? robot.links : robot.joints.map(joint => joint.name);
    if (!action.name.trim() || names.filter(name => name === action.name).length > 1) throw new MessageError(msg('节点名称不唯一，请在源码中修复'));
  }
  const oldChain = chainLabel(p);
  let selection = '';
  const removeLinks = new Set<string>(), removeJoints = new Set<string>();
  const refs = new Set<Attr>();
  const changeRef = (element: Element, attr: string, old: string, value: string) => {
    const attribute = element.getAttributeNode(attr);
    if (attribute?.value === old) { attribute.value = value; refs.add(attribute); }
  };
  if (action.kind === 'chain') {
    // Invalid numeric parameters do not prevent choosing a structural chain.
    const errors = topologyDiagnostics(robot); if (errors.length) throw new MessageError(joinMessages(errors));
    if (!robot.links.includes(action.base) || !robot.links.includes(action.tip)) throw new MessageError(msg("Base/Tip 不存在"));
    let current = action.tip;
    while (current !== action.base) {
      const joint = robot.joints.find(j => j.child === current); if (!joint) throw new MessageError(msg("Base 到 Tip 之间没有有向链")); current = joint.parent;
    }
    editYaml(p, p.entrypoints.app, doc => { doc.setIn(['robot', 'base_link'], action.base); doc.setIn(['robot', 'tip_link'], action.tip); });
    impacts.push(msg("Base / Tip：{v0} → {v1}；已有绑定保持原关节对应，不按序号重排。", {v0:String(action.base), v1:String(action.tip)}));
  } else if (action.kind === 'add') {
    if (!action.joint.trim() || !action.link.trim()) throw new MessageError(msg("名称不能为空"));
    writeRobot(p, addJoint(textOf(f), action.parent, action.joint.trim(), action.link.trim()));
    selection = `joint:${action.joint.trim()}`;
    impacts.push(msg("在 {v0} 下新增固定关节 {v1} 和 Link {v2}。", {v0:String(action.parent), v1:String(action.joint), v2:String(action.link)}));
  } else if (action.kind === 'rename') {
    const value = action.value.trim(); if (!value) throw new MessageError(msg("名称不能为空"));
    const names = action.node === 'link' ? robot.links : robot.joints.map(j => j.name);
    if (!names.includes(action.name)) throw new MessageError(msg("节点不存在"));
    if (value !== action.name && names.includes(value)) throw new MessageError(msg("节点名称已存在"));
    const target = children(root, action.node).find(n => n.getAttribute('name') === action.name)!;
    changeRef(target, 'name', action.name, value);
    for (const j of children(root, 'joint')) {
      if (action.node === 'link') for (const tag of ['parent', 'child']) { const n = child(j, tag); if (n) changeRef(n, 'link', action.name, value); }
      else { const mimic = child(j, 'mimic'); if (mimic) changeRef(mimic, 'joint', action.name, value); }
    }
    if (action.node === 'joint') for (const transmission of children(root, 'transmission')) for (const j of children(transmission, 'joint')) changeRef(j, 'name', action.name, value);
    const ambiguous = action.node === 'link' ? robot.joints.some(j => j.name === action.name) : robot.links.includes(action.name);
    if (!ambiguous) for (const gazebo of children(root, 'gazebo')) changeRef(gazebo, 'reference', action.name, value);
    // Unknown extensions are preserved. Exact-token references are flagged for review.
    for (const element of Array.from(root.getElementsByTagName('*')).filter(node => !isLegacyHardware(node))) for (const attr of Array.from(element.attributes)) {
      if (attr.value === action.name && !refs.has(attr)) warnings.push(msg("扩展/未识别引用 <{v0} {v1}=\"{v2}\"> 保持原文，请核对。", {v0:String(element.tagName), v1:String(attr.name), v2:String(action.name)}));
    }
    if (action.node === 'link') editYaml(p, p.entrypoints.app, doc => {
      for (const field of ['base_link', 'tip_link']) if (appDocument(fileById(p,p.entrypoints.app)!).data.robot[field] === action.name) { doc.setIn(['robot', field], value); impacts.push(msg("APP {v0}：{v1} → {v2}", {v0:String(field), v1:String(action.name), v2:String(value)})); }
    });
    else for (const [id, key] of [[p.entrypoints.hardware, 'hardware'], [p.entrypoints.binding, 'joint_bindings']] as const) editYaml(p, id, doc => {
      const list = doc.getIn([key]); if (!isSeq(list)) throw new MessageError(msg("{v0} 必须为列表", {v0:String(key)}));
      list.items.forEach((item, i) => { if (isMap(item) && item.get('joint_name') === action.name) { doc.setIn([key, i, 'joint_name'], value); impacts.push(msg("{v0}[{v1}].joint_name：{v2} → {v3}", {v0:String(key), v1:String(i), v2:String(action.name), v3:String(value)})); } });
    });
    impacts.unshift(msg("{v0}：{v1} → {v2}", {v0:String(action.node), v1:String(action.name), v2:String(value)})); selection = `${action.node}:${value}`; writeRobot(p, serializeXml(robot.doc));
  } else if (action.kind === 'reparent' || action.kind === 'rechild') {
    const j = robot.joints.find(j => j.name === action.joint); if (!j) throw new MessageError(msg("关节不存在"));
    const field = action.kind === 'reparent' ? 'parent' : 'child';
    const value = action.kind === 'reparent' ? action.parent : action.child;
    if (!robot.links.includes(value)) throw new MessageError(msg("Link 不存在"));
    writeRobot(p, editJoint(textOf(f), action.joint, field, value));
    impacts.push(msg("{v0} 的 {v1} Link：{v2} → {v3}。保留局部 origin，世界姿态可能变化。", {v0:String(action.joint), v1:String(field), v2:String(j[field]), v3:String(value)}));
    selection = `joint:${action.joint}`;
  } else {
    const incoming = action.node === 'joint' ? robot.joints.find(j => j.name === action.name) : robot.joints.find(j => j.child === action.name);
    if (!incoming) throw new MessageError(msg("根 Link 不能直接删除；请先调整模型结构"));
    removeLinks.add(incoming.child); removeJoints.add(incoming.name);
    if (action.mode === 'subtree') {
      let expanded = true;
      while (expanded) { expanded = false; for (const j of robot.joints) if (removeLinks.has(j.parent) && !removeJoints.has(j.name)) { removeLinks.add(j.child); removeJoints.add(j.name); expanded = true; } }
    } else for (const j of children(root, 'joint')) {
      const parent = child(j, 'parent'); if (parent?.getAttribute('link') === incoming.child) parent.setAttribute('link', incoming.parent);
    }
    for (const n of children(root)) {
      if ((n.localName === 'link' && removeLinks.has(n.getAttribute('name') || '')) || (n.localName === 'joint' && removeJoints.has(n.getAttribute('name') || ''))) root.removeChild(n);
      if (n.localName === 'transmission' && children(n, 'joint').some(j => removeJoints.has(j.getAttribute('name') || ''))) {
        root.removeChild(n); impacts.push(msg("移除引用被删除关节的 transmission {v0}", {v0:String(n.getAttribute('name') || '')}));
      }
    }
    for (const j of children(root, 'joint')) {
      const mimic = child(j, 'mimic'); if (mimic && removeJoints.has(mimic.getAttribute('joint') || '')) { j.removeChild(mimic); impacts.push(msg("{v0} 的 mimic 目标已删除，解除关联。", {v0:String(j.getAttribute('name'))})); }
    }
    for (const element of Array.from(root.getElementsByTagName('*')).filter(node => !isLegacyHardware(node))) for (const attr of Array.from(element.attributes)) if (removeLinks.has(attr.value) || removeJoints.has(attr.value)) warnings.push(msg("保留的 <{v0}> 可能引用已删除节点 {v1}，请核对。", {v0:String(element.tagName), v1:String(attr.value)}));
    editYaml(p, p.entrypoints.app, doc => {
      for (const field of ['base_link', 'tip_link']) if (removeLinks.has(appDocument(fileById(p,p.entrypoints.app)!).data.robot[field])) { doc.setIn(['robot', field], incoming.parent); impacts.push(msg("APP {v0} 调整为 {v1}", {v0:String(field), v1:String(incoming.parent)})); }
    });
    editYaml(p, p.entrypoints.hardware, doc => {
      const devices = doc.getIn(['hardware']); if (!isSeq(devices)) throw new MessageError(msg("hardware 必须为列表"));
      devices.items.forEach((device, i) => { if (isMap(device) && removeJoints.has(String(device.get('joint_name')))) { doc.setIn(['hardware', i, 'joint_name'], ''); impacts.push(msg("保留 Hardware {v0}，清除已删除关节名称。", {v0:String(device.get('id'))})); } });
    });
    editYaml(p, p.entrypoints.binding, doc => {
      const list = doc.getIn(['joint_bindings']); if (!isSeq(list)) throw new MessageError(msg("joint_bindings 必须为列表"));
      for (let i = list.items.length - 1; i >= 0; i--) { const item = list.items[i]; if (isMap(item) && removeJoints.has(String(item.get('joint_name')))) { impacts.push(msg("移除 {v0} 的 Drive {v1} 绑定。", {v0:String(item.get('joint_name')), v1:String(item.get('drive_id'))})); list.items.splice(i, 1); } }
    });
    impacts.unshift(msg("删除 Link：{v0}；Joint：{v1}", {v0:String([...removeLinks].join('、')), v1:String([...removeJoints].join('、'))}));
    if (action.mode === 'reattach') impacts.push(msg("后代重新挂接到 {v0}，保留局部 origin，世界姿态可能变化。", {v0:String(incoming.parent)}));
    selection = `link:${incoming.parent}`; writeRobot(p, serializeXml(robot.doc));
  }
  const errors = topologyDiagnostics(readRobot(textOf(fileById(p, p.entrypoints.urdf)!)));
  if (errors.length) throw new MessageError(joinMessages(errors));
  const newChain = chainLabel(p); if (oldChain.message !== newChain.message) impacts.push(msg("控制链：{v0} → {v1}；请复核绑定。", {v0:oldChain.text, v1:newChain.text}));
  if (action.kind !== 'rename') for (const key of Object.keys(p.editor.confirmations)) if (key.startsWith('drive:')) delete p.editor.confirmations[key];
  const uniqueWarnings=[...new Map(warnings.map(issue=>[issue.message,issue])).values()];
  if (warnings.length) p.editor.notices = [...(p.editor.notices || []), ...uniqueWarnings.map(issue => ({ fileId: f.id, ...issue }))];
  return { project: p, impacts:impacts.map(issue=>issue.message), impactMessages:impacts, warnings:uniqueWarnings.map(issue=>issue.message), warningMessages:uniqueWarnings, selection };
}

export function changeLinkGeometry(p: Project, name: string, group: 'visual' | 'collision', index: number, field: keyof GeometryView, value: string) {
  const f = editable(p, p.entrypoints.urdf);
  writeRobot(p, editGeometry(textOf(f), name, group, index, field, value));
}

export function topologyErrors(robot:ReturnType<typeof readRobot>):string[]{
  return topologyDiagnostics(robot).map(issue=>issue.message);
}
