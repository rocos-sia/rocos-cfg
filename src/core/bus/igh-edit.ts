import { m as msg, MessageError, type DiagnosticMessage } from '../project/messages';
import { preserveAppScalars } from '../documents/app-config';
import { preserveEcmScalars } from './ecm';
import { normalizeHardwareIntegers } from '../hardware/schema';
import { assertEditableFile } from '../modules/project';
import { isMap, isScalar, isSeq, type Document, type YAMLSeq } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { fileById, textOf, utf8, type Project } from '../project/types';
import { ighRules, targetStatus } from '../project/profiles';
import { deviceTemplate, recordTemplate, type DevicePreset } from '../project/templates';

type Path = (string | number)[];
export function editProjectYaml(p: Project, id: string, edit: (doc: Document) => void) {
  const file = fileById(p, id);
  if (!file || file.role === 'eni') throw new MessageError(msg("文件不存在或只读"));
  assertEditableFile(p,file);
  if (p.editor.buffers[id]) throw new MessageError(msg("请先应用或放弃相关文件的源码草稿"));
  const doc = yamlDocument(textOf(file)); normalizeHardwareIntegers(doc,file.role); if(file.role==='ecm')preserveEcmScalars(doc); if(file.role==='app')preserveAppScalars(doc); edit(doc);
  file.bytes = utf8.encode(doc.toString()); file.encoding = 'utf-8';
}
export function masterFileId(p: Project): string {
  if (p.entrypoints.master.kind !== 'igh' || !p.entrypoints.master.fileId) throw new MessageError(msg("当前不是 IgH 主站"));
  return p.entrypoints.master.fileId;
}
export function setInteger(doc: Document, path: Path, value: bigint, hex = false) {
  const scalar = doc.getIn(path, true);
  if (isScalar(scalar)) { scalar.value = value; scalar.format = hex ? 'HEX' : undefined; }
  else { const n = doc.createNode(value); if (isScalar(n) && hex) n.format = 'HEX'; doc.setIn(path, n); }
}
export function sequence(doc: Document, path: Path, create = false): YAMLSeq {
  let node = doc.getIn(path, true);
  if (create && (node === undefined || (isScalar(node) && node.value === null) || (isMap(node) && !node.items.length))) {
    const next = doc.createNode([]); if (node && typeof node === 'object' && 'comment' in node) next.comment = node.comment;
    doc.setIn(path, next); node = doc.getIn(path, true);
  }
  if (!isSeq(node)) throw new MessageError(msg("{v0} 不是列表，请先修复源码", {v0:String(path.join('.'))}));
  return node;
}
export function modifySequence(doc: Document, path: Path, operation: 'add' | 'remove' | 'up' | 'down', index = 0, value?: unknown) {
  const list = sequence(doc, path, operation === 'add');
  if (operation === 'add') { list.add(doc.createNode(value)); return; }
  if (index < 0 || index >= list.items.length) throw new MessageError(msg("列表条目已变化"));
  if (operation === 'remove') list.items.splice(index, 1);
  else {
    const target = index + (operation === 'up' ? -1 : 1);
    if (target < 0 || target >= list.items.length) return;
    [list.items[index], list.items[target]] = [list.items[target], list.items[index]];
  }
}
export type SlaveAction = { kind: 'add'; preset?: DevicePreset } | { kind: 'copy' | 'delete' | 'up' | 'down'; index: number } | { kind: 'move'; index: number; target: number };
export interface SlavePlan { project: Project; impacts: string[]; impactMessages: DiagnosticMessage[]; selected: number }
export function planSlaveChange(project: Project, action: SlaveAction): SlavePlan {
  const profile=targetStatus(project,'master');if(!profile.supported)throw new MessageError(profile);
  const p = structuredClone(project), impacts: DiagnosticMessage[] = [];
  const mapping = new Map<number, number>();
  let selected = 0;
  editProjectYaml(p, masterFileId(p), doc => {
    const slaves = sequence(doc, ['slaves']);
    const origins = slaves.items.map((_, i) => i);
    if (slaves.items.some(n => !isMap(n))) throw new MessageError(msg("从站列表含不支持的节点，请先修复源码"));
    if (slaves.items.some((n, i) => isMap(n) && Number(n.get('id')) !== i)) throw new MessageError(msg("现有从站 ID 与物理序号不一致，请先修复再调整顺序"));
    if (action.kind === 'add' || action.kind === 'copy') {
      if (slaves.items.length >= ighRules.maxSlaves) throw new MessageError(msg("当前目标最多支持 {v0} 个从站", {v0:String(ighRules.maxSlaves)}));
      if (action.kind === 'add') {
        const template=deviceTemplate(action.preset);
        slaves.add(doc.createNode({id:slaves.items.length,name:template.defaults.name,...template.data}));
        recordTemplate(p,template,{name:template.defaults.name},[masterFileId(p)]);
        origins.push(-1); selected = slaves.items.length - 1;
      } else {
        const old = slaves.items[action.index];
        if (!isMap(old)) throw new MessageError(msg("从站已不存在"));
        const copy = old.clone(); copy.set('dc_ref', false);
        slaves.items.splice(action.index + 1, 0, copy); origins.splice(action.index + 1, 0, -1);
        selected = action.index + 1;
        impacts.push(msg("复制 PDO/SDO 配置；新从站不继承 DC 参考时钟、Hardware 或关节绑定。"));
      }
    } else {
      const index = action.index;
      if (!Number.isInteger(index) || index < 0 || index >= slaves.items.length) throw new MessageError(msg("从站已不存在"));
      if (action.kind === 'delete') {
        slaves.items.splice(index, 1); origins.splice(index, 1); selected = Math.max(0, index - 1);
        impacts.push(msg("删除 Slave {v0}，其硬件设备和关节绑定将同时移除。", {v0:String(index)}));
      } else {
        const target = action.kind === 'move' ? action.target : index + (action.kind === 'up' ? -1 : 1);
        if (!Number.isInteger(target) || target < 0 || target >= slaves.items.length) throw new MessageError(msg("不能继续移动"));
        slaves.items.splice(target, 0, slaves.items.splice(index, 1)[0]);
        origins.splice(target, 0, origins.splice(index, 1)[0]); selected = target;
      }
    }
    origins.forEach((old, next) => {
      setInteger(doc, ['slaves', next, 'id'], BigInt(next));
      if (old >= 0) mapping.set(old, next);
      if (old >= 0 && old !== next) impacts.push(msg("Slave {v0} → Slave {v1}；关联 Hardware / Drive ID 同步调整。", {v0:String(old), v1:String(next)}));
    });
  });
  const remap = (id: number) => mapping.get(id);
  for (const [fileId, path, field] of [[p.entrypoints.hardware, 'hardware', 'id'], [p.entrypoints.binding, 'joint_bindings', 'drive_id']] as const) {
    if (!fileId || action.kind === 'add') continue;
    editProjectYaml(p, fileId, doc => {
      const list = sequence(doc, [path]);
      for (let i = list.items.length - 1; i >= 0; i--) {
        const item = list.items[i];
        if (!isMap(item)) throw new MessageError(msg("{v0} 有无效条目，请先修复", {v0:String(path)}));
        const raw = item.get(field);
        const id = typeof raw === 'bigint' || typeof raw === 'number' ? Number(raw) : NaN;
        if (!Number.isSafeInteger(id)) throw new MessageError(msg("{v0}.{v1} 无效，无法同步从站编号", {v0:String(path), v1:String(field)}));
        if (action.kind === 'delete' && id === action.index) {
          impacts.push(msg("移除 {v0} 条目 {v1}{v2}", {v0:String(path), v1:String(i), v2:(item.get('joint_name') ? msg('（{joint}）',{joint:String(item.get('joint_name'))}).text : String(''))}));
          list.items.splice(i, 1);
        } else if (remap(id) !== undefined && remap(id) !== id) setInteger(doc, [path, i, field], BigInt(remap(id)!));
      }
    });
  }
  // A new physical position needs a new human check of the drive parameters.
  if (action.kind !== 'add') {
    for (const key of Object.keys(p.editor.confirmations)) {
      if (!key.startsWith('drive:')) continue;
      const id = Number(key.slice(6));
      if (remap(id) !== id) delete p.editor.confirmations[key];
    }
  }
  if (impacts.length) impacts.push(msg("请核对真实接线顺序；本操作可撤销。"));
  return { project: p, impacts:impacts.map(issue=>issue.message), impactMessages:impacts, selected };
}
