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
export interface RobotPlan { project: Project; impacts: string[]; warnings: string[]; selection: string }

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
    return controlChain(textOf(fileById(p, p.entrypoints.urdf)!), a.robot.base_link, a.robot.tip_link).map(j => j.name).join(' → ') || '无可动关节';
  } catch { return '尚未形成有效控制链'; }
}
export function planRobotChange(project: Project, action: RobotAction): RobotPlan {
  const p = structuredClone(project), impacts: string[] = [], warnings: string[] = [];
  const f = editable(p, p.entrypoints.urdf), robot = readRobot(textOf(f)), root = robot.doc.documentElement;
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
    impacts.push(`Base / Tip：${action.base} → ${action.tip}；已有绑定保持原关节对应，不按序号重排。`);
  } else if (action.kind === 'add') {
    if (!action.joint.trim() || !action.link.trim()) throw new MessageError(msg("名称不能为空"));
    writeRobot(p, addJoint(textOf(f), action.parent, action.joint.trim(), action.link.trim()));
    selection = `joint:${action.joint.trim()}`;
    impacts.push(`在 ${action.parent} 下新增固定关节 ${action.joint} 和 Link ${action.link}。`);
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
      if (attr.value === action.name && !refs.has(attr)) warnings.push(`扩展/未识别引用 <${element.tagName} ${attr.name}="${action.name}"> 保持原文，请核对。`);
    }
    if (action.node === 'link') editYaml(p, p.entrypoints.app, doc => {
      for (const field of ['base_link', 'tip_link']) if (appDocument(fileById(p,p.entrypoints.app)!).data.robot[field] === action.name) { doc.setIn(['robot', field], value); impacts.push(`APP ${field}：${action.name} → ${value}`); }
    });
    else for (const [id, key] of [[p.entrypoints.hardware, 'hardware'], [p.entrypoints.binding, 'joint_bindings']] as const) editYaml(p, id, doc => {
      const list = doc.getIn([key]); if (!isSeq(list)) throw new MessageError(msg("{v0} 必须为列表", {v0:String(key)}));
      list.items.forEach((item, i) => { if (isMap(item) && item.get('joint_name') === action.name) { doc.setIn([key, i, 'joint_name'], value); impacts.push(`${key}[${i}].joint_name：${action.name} → ${value}`); } });
    });
    impacts.unshift(`${action.node}：${action.name} → ${value}`); selection = `${action.node}:${value}`; writeRobot(p, serializeXml(robot.doc));
  } else if (action.kind === 'reparent' || action.kind === 'rechild') {
    const j = robot.joints.find(j => j.name === action.joint); if (!j) throw new MessageError(msg("关节不存在"));
    const field = action.kind === 'reparent' ? 'parent' : 'child';
    const value = action.kind === 'reparent' ? action.parent : action.child;
    if (!robot.links.includes(value)) throw new MessageError(msg("Link 不存在"));
    writeRobot(p, editJoint(textOf(f), action.joint, field, value));
    impacts.push(`${action.joint} 的 ${field} Link：${j[field]} → ${value}。保留局部 origin，世界姿态可能变化。`);
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
        root.removeChild(n); impacts.push(`移除引用被删除关节的 transmission ${n.getAttribute('name') || ''}`);
      }
    }
    for (const j of children(root, 'joint')) {
      const mimic = child(j, 'mimic'); if (mimic && removeJoints.has(mimic.getAttribute('joint') || '')) { j.removeChild(mimic); impacts.push(`${j.getAttribute('name')} 的 mimic 目标已删除，解除关联。`); }
    }
    for (const element of Array.from(root.getElementsByTagName('*')).filter(node => !isLegacyHardware(node))) for (const attr of Array.from(element.attributes)) if (removeLinks.has(attr.value) || removeJoints.has(attr.value)) warnings.push(`保留的 <${element.tagName}> 可能引用已删除节点 ${attr.value}，请核对。`);
    editYaml(p, p.entrypoints.app, doc => {
      for (const field of ['base_link', 'tip_link']) if (removeLinks.has(appDocument(fileById(p,p.entrypoints.app)!).data.robot[field])) { doc.setIn(['robot', field], incoming.parent); impacts.push(`APP ${field} 调整为 ${incoming.parent}`); }
    });
    editYaml(p, p.entrypoints.hardware, doc => {
      const devices = doc.getIn(['hardware']); if (!isSeq(devices)) throw new MessageError(msg("hardware 必须为列表"));
      devices.items.forEach((device, i) => { if (isMap(device) && removeJoints.has(String(device.get('joint_name')))) { doc.setIn(['hardware', i, 'joint_name'], ''); impacts.push(`保留 Hardware ${device.get('id')}，清除已删除关节名称。`); } });
    });
    editYaml(p, p.entrypoints.binding, doc => {
      const list = doc.getIn(['joint_bindings']); if (!isSeq(list)) throw new MessageError(msg("joint_bindings 必须为列表"));
      for (let i = list.items.length - 1; i >= 0; i--) { const item = list.items[i]; if (isMap(item) && removeJoints.has(String(item.get('joint_name')))) { impacts.push(`移除 ${item.get('joint_name')} 的 Drive ${item.get('drive_id')} 绑定。`); list.items.splice(i, 1); } }
    });
    impacts.unshift(`删除 Link：${[...removeLinks].join('、')}；Joint：${[...removeJoints].join('、')}`);
    if (action.mode === 'reattach') impacts.push(`后代重新挂接到 ${incoming.parent}，保留局部 origin，世界姿态可能变化。`);
    selection = `link:${incoming.parent}`; writeRobot(p, serializeXml(robot.doc));
  }
  const errors = topologyDiagnostics(readRobot(textOf(fileById(p, p.entrypoints.urdf)!)));
  if (errors.length) throw new MessageError(joinMessages(errors));
  const newChain = chainLabel(p); if (oldChain !== newChain) impacts.push(`控制链：${oldChain} → ${newChain}；请复核绑定。`);
  if (action.kind !== 'rename') for (const key of Object.keys(p.editor.confirmations)) if (key.startsWith('drive:')) delete p.editor.confirmations[key];
  if (warnings.length) p.editor.notices = [...(p.editor.notices || []), ...[...new Set(warnings)].map(message => ({ fileId: f.id, message }))];
  return { project: p, impacts, warnings: [...new Set(warnings)], selection };
}

export function changeLinkGeometry(p: Project, name: string, group: 'visual' | 'collision', index: number, field: keyof GeometryView, value: string) {
  const f = editable(p, p.entrypoints.urdf);
  writeRobot(p, editGeometry(textOf(f), name, group, index, field, value));
}

export function topologyErrors(robot:ReturnType<typeof readRobot>):string[]{
  return topologyDiagnostics(robot).map(issue=>issue.message);
}
