import { modules } from './index';
import type { ModuleRegistry } from './registry';
import type { Project, ProjectFile, ModuleSnapshot, Diagnostic } from '../project/types';
export const moduleInstanceKey = (m: ModuleSnapshot) => m.instanceId || m.id;
export function fileModule(p: Pick<Project, 'modules'>, file: ProjectFile, registry: ModuleRegistry = modules) {
  const owner = p.modules?.find(m => m.fileIds.includes(file.id) || m.stateFileIds?.includes(file.id));
  if (owner) {
    if (owner.id === 'resource' && owner.version === 1) return registry.detect(file).find(m => m.role === 'resource') || registry.get('resource');
    return registry.get(owner.id, owner.version);
  }
  if (file.owner !== file.role) return registry.get(file.owner);
  // Legacy resources were grouped by role, so recognize supported asset formats
  // when no explicit module claim exists. Never re-detect an unknown module.
  if (file.role === 'resource') return registry.detect(file).find(m => m.role === 'resource') || registry.get('resource');
  return registry.get(file.role);
}
export function moduleSnapshots(p: Project, registry: ModuleRegistry = modules): ModuleSnapshot[] {
  const snapshots = [...(p.modules || [])], claimed = new Set(snapshots.flatMap(m => [...m.fileIds, ...(m.stateFileIds || [])]));
  for (const file of p.files) if (!claimed.has(file.id)) {
    const adapter = fileModule(p, file, registry);
    snapshots.push({ id: adapter?.id || file.owner, version: adapter?.version || 1, instanceId: `file:${file.id}`,
      required: ['igh', 'ecm', 'eni', 'urdf', 'hardware', 'binding', 'app', 'editor-state'].includes(adapter?.id || ''), fileIds: [file.id] });
  }
  return snapshots;
}
export function unsupportedRequired(p: Project, registry: ModuleRegistry = modules) {
  return moduleSnapshots(p, registry).filter(m => m.required && !registry.get(m.id, m.version));
}
export function readonlyFile(p: Project, file: ProjectFile, registry: ModuleRegistry = modules) {
  const adapter = fileModule(p, file, registry);
  const state = p.modules?.some(m => m.stateFileIds?.includes(file.id));
  return file.role === 'eni' || !!state || !adapter || adapter.capabilities.readonly || adapter.capabilities.desktop && registry.platform !== 'desktop';
}
export function assertEditableFile(p: Project, file: ProjectFile) {
  if (readonlyFile(p, file)) throw new Error(file.role === 'eni' ? 'ENI 始终只读' : '模块不受支持或文件只读，请保留原文件');
}
export function moduleRoots(p: Project, registry: ModuleRegistry = modules) {
  return moduleSnapshots(p, registry).flatMap(m => m.runtimeFileIds || (m.requiredForRuntime ? m.fileIds : []));
}
export function moduleDependencies(p: Project, id: string, registry: ModuleRegistry = modules): string[] {
  const all = moduleSnapshots(p, registry), owner = all.find(m => m.fileIds.includes(id));
  return (owner?.dependsOn || []).flatMap(key => all.find(m => moduleInstanceKey(m) === key)?.fileIds || []);
}
export function validateModules(p: Project, active: Set<string>, registry: ModuleRegistry = modules): Diagnostic[] {
  const diagnostics: Diagnostic[] = [], all = moduleSnapshots(p, registry), visiting = new Set<string>(), visited = new Set<string>();
  const add = (code: string, message: string, fileId?: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push({ code, message, fileId, severity });
  const walk = (m: ModuleSnapshot) => {
    const key = moduleInstanceKey(m);
    if (visiting.has(key)) { add('module.cycle', `模块依赖出现环：${key}`, m.fileIds[0]); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dep of m.dependsOn || []) {
      const target = all.find(x => moduleInstanceKey(x) === dep);
      if (!target) add('module.dependency', `模块 ${key} 缺少依赖：${dep}`, m.fileIds[0]); else walk(target);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const m of all) {
    const inUse = m.requiredForRuntime || m.fileIds.some(id => active.has(id));
    if (!registry.get(m.id, m.version)) add('module.unsupported', `模块 ${m.id} v${m.version} 不受支持；文件和元数据仅保留`, m.fileIds[0], inUse ? 'error' : 'warning');
    if (inUse) walk(m);
  }
  for (const id of active) if (!p.files.some(f => f.id === id)) add('module.file', `模块运行依赖文件缺失或指向工程编辑状态：${id}`, id);
  for (const file of p.files.filter(f => active.has(f.id))) {
    if (all.some(m => m.stateFileIds?.includes(file.id)) || ['editor-state', 'profile', 'template'].includes(file.role) || file.path.startsWith('project-data/')) { add('module.state', `运行依赖不能包含模块工具状态：${file.path}`, file.id); continue; }
    const adapter = fileModule(p, file, registry); if (!adapter) continue;
    if (adapter.role !== file.role) { add('module.role', `模块 ${adapter.id} 与文件角色 ${file.role} 不一致`, file.id); continue; }
    if (adapter.capabilities.desktop && registry.platform !== 'desktop') { add('module.desktop', `模块 ${adapter.id} 需要桌面能力`, file.id); continue; }
    try { diagnostics.push(...adapter.validate(adapter.parse(file), { project: p, file })); }
    catch (error) { add('module.parse', `${file.path}：${String(error)}`, file.id); }
  }
  return diagnostics;
}
