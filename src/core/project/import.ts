import { m as msg, MessageError } from './messages';
import { type Project, type ProjectFile, type FileRole, type TargetProfile, uid } from './types';
import { modules } from '../modules';
import type { ModuleRegistry } from '../modules/registry';
import { fileModule } from '../modules/project';
import { decodeXml, xmlDocument } from '../documents/xml';
import { checkPaths, resourceFilename } from './paths';
import { collectReferences } from './references';
import { attachProfile, baseTarget } from './profiles';

export type ImportSlot = 'master' | 'eni' | 'app' | 'urdf' | 'hardware' | 'binding';
export interface ImportPlan {
  projectId: string; revision: number; single: boolean; files: ProjectFile[]; matchUrdfMeshes?: boolean;
}
export type ImportSelection = Partial<Record<ImportSlot, string | 'keep'>>;
export const importSlot = (role: FileRole): ImportSlot | undefined => role === 'igh' || role === 'ecm' ? 'master' :
  ['eni', 'app', 'urdf', 'hardware', 'binding'].includes(role) ? role as ImportSlot : undefined;
export function activeImportFile(p: Project, slot: ImportSlot) {
  return slot === 'master' ? p.entrypoints.master.fileId : slot === 'eni' ? p.entrypoints.master.eniFileId : p.entrypoints[slot];
}
export function inspectImport(p: Project, entries: Map<string, Uint8Array>, single = false, registry: ModuleRegistry = modules): ImportPlan {
  checkPaths([...entries.keys()]);
  const files: ProjectFile[] = [];
  for (const [path, bytes] of entries) {
    if (path === 'rocos-project.json' || path.startsWith('project-data/')) throw new MessageError(msg("此文件包含工程元数据，请使用“打开工程”"));
    let role: FileRole = 'resource', text = '', encoding: string | undefined, readable = true;
    try {
      if (/\.(xml|urdf|dae)$/i.test(path)) ({ text, encoding } = decodeXml(bytes));
      else if (/\.(ya?ml|json|gltf|txt|lua)$/i.test(path)) { encoding = 'utf-8'; text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      role = /\.(ya?ml|xml|urdf)$/i.test(path) ? 'attachment' : 'resource';
    } catch { role = 'attachment'; readable = false; }
    const file = { id: uid(), path, role, owner: role, bytes, encoding };
    const candidates = readable ? registry.detect(file) : [];
    if (candidates.length > 1) throw new MessageError(msg("文件用途不唯一：{v0}（{v1}）", {v0:String(path), v1:String(candidates.map(m => m.id).join('、'))}));
    if (candidates.length === 1) { file.role = candidates[0].role; file.owner = candidates[0].id; }
    files.push(file);
  }
  return { projectId: p.id, revision: p.revision, single, files };
}
export function importCandidates(plan: ImportPlan) {
  const groups = new Map<ImportSlot, ProjectFile[]>();
  for (const file of plan.files) { const slot = importSlot(file.role); if (slot) groups.set(slot, [...(groups.get(slot) || []), file]); }
  return groups;
}
export function defaultImportSelection(plan: ImportPlan): ImportSelection {
  return Object.fromEntries([...importCandidates(plan)].filter(([, files]) => files.length === 1).map(([slot, files]) => [slot, files[0].id]));
}
export function applyImport(p: Project, plan: ImportPlan, selection = defaultImportSelection(plan), registry: ModuleRegistry = modules): Project {
  if (p.id !== plan.projectId || p.revision !== plan.revision) throw new MessageError(msg("导入期间工程已变化，请重新选择文件"));
  const next = structuredClone(p), ids = new Map<string, string>();
  const groups = importCandidates(plan);
  for (const [slot, files] of groups) {
    const chosen = selection[slot];
    if (!chosen || chosen !== 'keep' && !files.some(f => f.id === chosen)) throw new MessageError(msg("请选择 {v0} 的活动配置；其他候选文件仍会保留", {v0:String(slot)}));
  }
  const replaced = new Set<string>();
  for (const incoming of plan.files) {
    const file = structuredClone(incoming), slot = importSlot(file.role);
    // Only an explicitly selected single configuration adopts its current active path.
    const active = slot && next.files.find(f => f.id === activeImportFile(p, slot));
    if (plan.single && slot && selection[slot] === incoming.id && active?.role === file.role) file.path = active.path;
    if (plan.single && file.role === 'eni' && !active && !file.path.includes('/')) file.path = 'master/' + file.path;
    const old = next.files.find(f => f.path === file.path);
    if (old) {
      const oldModule = fileModule(next, old, registry);
      if (!oldModule || next.modules?.some(m => m.stateFileIds?.includes(old.id))) throw new MessageError(msg("不能覆盖未知模块或工具状态文件：{v0}", {v0:String(old.path)}));
      if (oldModule.id !== file.owner && next.modules) next.modules = next.modules.map(m => ({ ...m, fileIds: m.fileIds.filter(id => id !== old.id), runtimeFileIds: m.runtimeFileIds?.filter(id => id !== old.id) })).filter(m => m.fileIds.length || m.stateFileIds?.length);
      if (old.role !== file.role && importSlot(old.role)) throw new MessageError(msg("导入用途与现有配置冲突：{v0}（{v1} → {v2}）", {v0:String(file.path), v1:String(old.role), v2:String(file.role)}));
      if (slot && selection[slot] === 'keep' && active?.id === old.id) throw new MessageError(msg("保留当前配置时不能覆盖同一路径：{v0}", {v0:String(file.path)}));
      file.id = old.id; replaced.add(old.id);
      next.files = next.files.filter(f => f.id !== old.id);
      // Retain source drafts and their original baseHash. Applying them after a
      // replacement must pass the existing conflict check, never silently discard.
    }
    ids.set(incoming.id, file.id); next.files.push(file);
  }
  checkPaths(next.files.map(f => f.path));
  let bindingChanged = false;
  for (const [slot] of groups) {
    const selected = selection[slot]; if (!selected || selected === 'keep') continue;
    const id = ids.get(selected)!;
    const file = next.files.find(f => f.id === id)!;
    if (slot === 'master') {
      const kind = file.role as 'igh' | 'ecm';
      const changedKind=kind!==next.entrypoints.master.kind;
      if (changedKind) next.targets.master = masterProfile(kind);
      next.entrypoints.master.kind = kind; next.entrypoints.master.fileId = id;
      if(changedKind)attachProfile(next,'master');
    } else if (slot === 'eni') next.entrypoints.master.eniFileId = id;
    else next.entrypoints[slot] = id;
    bindingChanged = true;
  }
  if (bindingChanged || [...replaced].some(id => { const f = p.files.find(f => f.id === id); return f && importSlot(f.role); })) next.editor.confirmations = {};
  next.references = next.references.filter(r => !replaced.has(r.sourceFileId));
  next.references = collectReferences(next, registry);
  if(plan.matchUrdfMeshes) {
    const importedIds=new Set(ids.values());
    next.references=next.references.map(ref=>{
      if(!importedIds.has(ref.sourceFileId)||!ref.field.startsWith('mesh[')||next.files.find(f=>f.id===ref.sourceFileId)?.role!=='urdf')return ref;
      const candidates=next.files.filter(f=>importedIds.has(f.id)&&f.role==='resource'&&f.path.split('/').at(-1)===resourceFilename(ref.original));
      return candidates.length===1?{...ref,state:'internal',targetFileId:candidates[0].id}:ref;
    });
  }
  return next;
}
export function masterProfile(kind: 'igh' | 'ecm'): TargetProfile {
  return baseTarget(kind);
}
