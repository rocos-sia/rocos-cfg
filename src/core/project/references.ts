import { fileById, type Project, type FileReference } from './types';
import { resourcePath } from './paths';
export { elements } from '../documents/xml';
import { modules } from '../modules';
import type { ModuleRegistry } from '../modules/registry';
import { fileModule, moduleInstanceKey, moduleSnapshots } from '../modules/project';
export function collectReferences(p: Project, registry: ModuleRegistry = modules): FileReference[] {
  const refs: FileReference[] = [];
  const add = (id: string, field: string, original: unknown, kind: 'file' | 'directory' = 'file', uri = false) => {
    if (typeof original !== 'string' || !original || (uri && /^(data:|#)/.test(original))) return;
    const source = fileById(p, id)!;
    const matches = p.references.filter(r => r.sourceFileId === id && r.original === original);
    const prior = matches.find(r => r.field === field) || (matches.length === 1 ? matches[0] : undefined);
    const mappedFile = prior?.targetFileId && fileById(p, prior.targetFileId);
    const resolved = resourcePath(source.path, original, p.packageMap, uri);
    const targetPath = kind === 'directory' ? (prior?.targetPath || resolved) : undefined;
    const target = kind === 'file' ? (mappedFile || p.files.find(f => f.path === resolved)) : undefined;
    const inside = kind === 'file' ? !!target : !!targetPath && p.files.some(f => f.path.startsWith(targetPath + '/'));
    refs.push({ sourceFileId: id, field, original, kind, uri, targetFileId: target?.id, targetPath,
      state: prior?.state === 'external' ? 'external' : inside ? 'internal' : 'missing' });
  };
  for (const file of p.files) {
    const adapter = fileModule(p, file, registry);
    if (!adapter) { refs.push(...p.references.filter(r => r.sourceFileId === file.id)); continue; }
    try { for (const ref of adapter.references(adapter.parse(file), { project: p, file })) add(file.id, ref.field, ref.original, ref.kind, ref.uri); }
    catch { /* Parsing diagnostics are collected by the module validator. */ }
  }
  return refs;
}
export function referenceTargets(p: Project, ref: FileReference) {
  if (ref.state !== 'internal') return [];
  if (ref.kind === 'directory') return p.files.filter(f => f.path.startsWith(ref.targetPath + '/'));
  const file = fileById(p, ref.targetFileId); return file ? [file] : [];
}
export function activeFileIds(p: Project, refs = collectReferences(p), registry: ModuleRegistry = modules): Set<string> {
  const snapshots = moduleSnapshots(p, registry), byKey = new Map(snapshots.map(m => [moduleInstanceKey(m), m]));
  const owners = new Map(snapshots.flatMap(m => m.fileIds.map(id => [id, m] as const)));
  const moduleQueue = snapshots.filter(m => m.requiredForRuntime || m.runtimeFileIds?.length).map(moduleInstanceKey), seenModules = new Set<string>();
  const roots = snapshots.flatMap(m => m.runtimeFileIds || (m.requiredForRuntime ? m.fileIds : []));
  const active = new Set<string>(); const queue = [p.entrypoints.master.fileId, p.entrypoints.app, ...roots].filter((id): id is string => !!id);
  while (queue.length || moduleQueue.length) {
    if (moduleQueue.length) {
      const key = moduleQueue.shift()!; if (seenModules.has(key)) continue; seenModules.add(key);
      for (const dep of byKey.get(key)?.dependsOn || []) {
        moduleQueue.push(dep); queue.push(...(byKey.get(dep)?.fileIds || []));
      }
    } else {
      const id = queue.shift()!; if (active.has(id)) continue;
      active.add(id); const owner = owners.get(id); if (owner) moduleQueue.push(moduleInstanceKey(owner));
      for (const ref of refs.filter(r => r.sourceFileId === id)) for (const file of referenceTargets(p, ref)) queue.push(file.id);
    }
  }
  return active;
}
