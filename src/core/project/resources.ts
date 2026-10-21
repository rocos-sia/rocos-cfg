import { fileModule, readonlyFile } from '../modules/project';
import { collectReferences } from './references';
import { safePath, checkPaths } from './paths';
import { fileById, type FileReference, type Project } from './types';
const criticalRoles: Record<string, 'urdf' | 'hardware' | 'binding' | 'eni'> = { 'robot.urdf': 'urdf', 'robot.hardware_config': 'hardware', 'robot.joint_binding': 'binding', eni: 'eni' };
export function mapReference(p: Project, ref: FileReference, target: { fileId: string } | { directory: string } | { external: true } | null) {
  const current = collectReferences(p).find(r => r.sourceFileId === ref.sourceFileId && r.field === ref.field && r.original === ref.original);
  if (!current) throw new Error('资源引用已变化，请重新选择');
  const source = fileById(p, ref.sourceFileId)!;
  if (readonlyFile(p, source)) throw new Error('不能调整只读模块的内部引用');
  const next = { ...current }; delete next.targetFileId; delete next.targetPath;
  if (target && 'external' in target) {
    if (criticalRoles[ref.field]) throw new Error('主站和 APP 核心配置必须纳入工程，不能标记为外部资源');
    next.state = 'external';
  } else if (target && 'fileId' in target) {
    if (current.kind === 'directory') throw new Error('此引用需要目录');
    const file = fileById(p, target.fileId); if (!file) throw new Error('目标文件不存在');
    const role = criticalRoles[ref.field]; if (role && file.role !== role) throw new Error(`此引用需要 ${role} 文件`);
    if (role === 'eni') p.entrypoints.master.eniFileId = file.id;
    else if (role) p.entrypoints[role] = file.id;
    next.targetFileId = file.id; next.state = 'internal';
  } else if (target && 'directory' in target) {
    if (current.kind !== 'directory') throw new Error('此引用需要文件');
    safePath(target.directory);
    if (!p.files.some(f => f.path.startsWith(target.directory + '/'))) throw new Error('目录内没有已导入文件');
    next.targetPath = target.directory; next.state = 'internal';
  } else next.state = 'missing';
  p.references = p.references.filter(r => !(r.sourceFileId === ref.sourceFileId && r.field === ref.field));
  if (target) p.references.push(next);
}
export function setPackagePath(p: Project, name: string, path: string | null) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Package 名称只允许字母、数字、下划线和连字符');
  if (path === null) { delete p.packageMap[name]; return; }
  safePath(path);
  if (!p.files.some(f => f.path.startsWith(path + '/'))) throw new Error('目标包目录内没有已导入文件');
  p.packageMap[name] = path;
}
export function moveResource(p: Project, id: string, path: string) {
  const file = fileById(p, id); if (!file) throw new Error('文件不存在');
  if (!fileModule(p, file) || p.modules?.some(m => m.stateFileIds?.includes(id))) throw new Error('不能移动未知模块或工具状态文件');
  safePath(path); if (path === 'rocos-project.json' || path.startsWith('project-data/')) throw new Error('不能使用工程保留路径');
  // Freeze currently resolved file references before relocating anything.
  p.references = collectReferences(p);
  file.path = path; checkPaths(p.files.map(f => f.path));
}

export function resourceResolver(p: Project) {
  const refs = collectReferences(p);
  return (sourceId: string, original: string) => {
    const candidates = refs.filter(r => r.sourceFileId === sourceId && r.original === original && r.state === 'internal');
    const ids = new Set(candidates.map(r => r.targetFileId));
    if (ids.size === 1) return fileById(p, candidates[0].targetFileId);
    return undefined;
  };
}
