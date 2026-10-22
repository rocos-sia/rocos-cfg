import { validConfiguration } from './configuration';
import { m as msg, MessageError, messageFields, type MessageInput, type MessageTemplate } from './messages';
import { packZip, unpackZip, LIMITS, type ArchiveLimits } from './zip';
import { digest, uid, utf8, type Project, type ProjectFile, type FileRole, type ModuleSnapshot } from './types';
import { checkPaths, safePath } from './paths';
import { collectReferences } from './references';
import type { ArchiveProgress } from './progress';
import { FORMAT_VERSION, PROJECT_SCHEMA_VERSION, MigrationRegistry, type MigrationData, type MigrationReport } from './migrations';

const FORMAT = 'rocos-configurator-project';
const STATE = 'project-data/editor-state.json';
import { modules } from '../modules';
import type { ModuleRegistry } from '../modules/registry';
import { fileModule, moduleSnapshots, unsupportedRequired } from '../modules/project';
import { validTemplateUse } from './templates';
export interface ManifestV1 {
  format: typeof FORMAT; formatVersion: 1; projectSchemaVersion: 1;
  createdWith: { name: string; version: string };
  project: Pick<Project, 'id' | 'name' | 'description' | 'revision' | 'createdAt' | 'modifiedAt'>;
  snapshotId: string; targets: Project['targets']; entrypoints: Project['entrypoints'];
  files: { id: string; path: string; role: FileRole; owner: string; size: number; sha256: string; encoding?: string }[];
  modules: ModuleSnapshot[];
  lastSavedWith?: { name: string; version: string };
  references: Project['references']; packageMap: Project['packageMap'];
  portability: { state: 'complete' | 'incomplete'; unresolved: Project['references']; missingSnapshots?:string[] };
  editorStateFileId: string;
}
export type Manifest = ManifestV1;
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function assert(condition: unknown, message: MessageInput): asserts condition { if (!condition) throw new MessageError(message); }
export function validateManifest(value: unknown): asserts value is Manifest {
  validateManifestV1(value);
}
/** Keep historical validators pinned when adding a later project schema. */
export function validateManifestV1(value: unknown): asserts value is ManifestV1 {
  assert(object(value) && value.format === FORMAT, msg("不是 ROCOS 工程文件"));
  assert(value.formatVersion === 1 && value.projectSchemaVersion === 1, msg("工程格式版本不受支持；请保留原文件并使用对应版本打开"));
  assert(object(value.project) && typeof value.project.id === 'string' && typeof value.project.name === 'string' && Number.isSafeInteger(value.project.revision) && value.project.revision >= 0, msg("工程信息无效"));
  for (const key of ['createdAt','modifiedAt']) assert(typeof value.project[key] === 'string' && Number.isFinite(Date.parse(value.project[key])), msg("工程时间无效"));
  assert(typeof value.snapshotId === 'string' && typeof value.project.description === 'string', msg("工程元数据无效"));
  assert(object(value.targets) && object(value.targets.app) && object(value.targets.master), msg("缺少目标版本"));
  assert(object(value.entrypoints) && object(value.entrypoints.master) && ['igh','ecm'].includes(value.entrypoints.master.kind), msg("主站入口无效"));
  assert(Array.isArray(value.files) && Array.isArray(value.modules) && Array.isArray(value.references) && object(value.packageMap), msg("工程索引无效"));
  assert(object(value.portability) && ['complete','incomplete'].includes(value.portability.state), msg("工程完整性声明无效"));
  const ids = new Set<string>();
  for (const file of value.files) {
    assert(object(file) && typeof file.id === 'string' && !ids.has(file.id) && typeof file.path === 'string' && typeof file.role === 'string' && !!file.role && typeof file.owner === 'string' && Number.isSafeInteger(file.size) && file.size >= 0 && /^[0-9a-f]{64}$/.test(file.sha256), msg("文件索引记录无效"));
    assert(file.path !== 'rocos-project.json', msg("manifest 不能包含自身")); ids.add(file.id);
  }
  checkPaths(value.files.map((f: any) => f.path));
  const ep = value.entrypoints;
  for (const id of [ep.master.fileId, ep.master.eniFileId, ep.app, ep.urdf, ep.hardware, ep.binding, value.editorStateFileId]) assert(id === null || (typeof id === 'string' && ids.has(id)), msg("入口指向未登记的文件"));
  const expectRole = (id: string | null, role: FileRole) => { if (id) assert(value.files.find((f: any) => f.id === id)?.role === role, msg("入口文件角色不匹配")); };
  expectRole(ep.master.fileId, ep.master.kind); expectRole(ep.master.eniFileId, 'eni');
  for (const role of ['app','urdf','hardware','binding'] as const) expectRole(ep[role], role);
  expectRole(value.editorStateFileId, 'editor-state');
  assert(typeof value.editorStateFileId === 'string', msg("缺少编辑状态"));
  const instances = new Set<string>(), claimed = new Set<string>();
  for (const module of value.modules) {
    assert(object(module) && typeof module.id === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(module.id) && Number.isSafeInteger(module.version) && module.version >= 1 && typeof module.required === 'boolean' && Array.isArray(module.fileIds), msg("模块声明无效"));
    const instance = module.instanceId ?? module.id;
    assert(typeof instance === 'string' && !!instance && !instances.has(instance), msg("模块实例 ID 重复或无效")); instances.add(instance);
    assert(module.requiredForRuntime === undefined || typeof module.requiredForRuntime === 'boolean', msg("模块运行需求无效"));
    for (const field of ['fileIds', 'stateFileIds', 'runtimeFileIds']) {
      const list = module[field]; if (list === undefined) continue;
      assert(Array.isArray(list) && new Set(list).size === list.length && list.every((id: unknown) => typeof id === 'string' && ids.has(id)), msg("模块文件引用无效"));
    }
    for (const id of [...module.fileIds, ...(module.stateFileIds || [])]) { assert(!claimed.has(id), msg("文件被多个模块重复拥有")); claimed.add(id); }
    assert(!module.runtimeFileIds || module.runtimeFileIds.every((id: string) => module.fileIds.includes(id)), msg("模块运行入口不属于模块"));
    assert(module.dependsOn === undefined || Array.isArray(module.dependsOn) && module.dependsOn.every((id: unknown) => typeof id === 'string'), msg("模块依赖声明无效"));
  }
  for (const ref of value.references) {
    assert(object(ref) && ids.has(ref.sourceFileId) && typeof ref.field === 'string' && typeof ref.original === 'string' && ['internal','external','missing'].includes(ref.state), msg("资源引用无效"));
    assert(ref.kind === undefined || ['file', 'directory'].includes(ref.kind), msg("资源引用类型无效"));
    assert(ref.uri === undefined || typeof ref.uri === 'boolean', msg("资源 URI 标记无效"));
    if (ref.targetPath !== undefined) { assert(typeof ref.targetPath === 'string', msg("资源目录无效")); safePath(ref.targetPath); }
    if (ref.state === 'internal') assert(ref.kind === 'directory'
      ? typeof ref.targetPath === 'string' && value.files.some((f: any) => f.path.startsWith(ref.targetPath + '/'))
      : ids.has(ref.targetFileId), msg("资源目标不存在"));
  }
  for (const [key, path] of Object.entries(value.packageMap)) {
    assert(!['__proto__', 'constructor', 'prototype'].includes(key) && /^[a-zA-Z0-9_-]+$/.test(key) && typeof path === 'string', msg("包路径映射无效")); safePath(path as string);
  }
}
export async function saveProject(project: Project, version = 'development', registry: ModuleRegistry = modules, progress?:ArchiveProgress): Promise<Uint8Array> {
  progress?.(2);
  const p = structuredClone(project); p.references = collectReferences(p, registry);
  const original = p.archiveMetadata || {}, stateId = original.editorStateFileId || 'editor-state';
  const statePath = original.files?.find((f: any) => f.id === stateId)?.path || STATE;
  assert(!p.files.some(f => f.path === statePath || f.path === 'rocos-project.json' || f.id === stateId), msg("文件占用了工程保留名称"));
  const files: ProjectFile[] = [...p.files, { id: stateId, path: statePath, role: 'editor-state', owner: 'editor-state', bytes: utf8.encode(JSON.stringify(p.editor)) }];
  let hashed=0;progress?.(10);
  const index = await Promise.all(files.map(async ({bytes, ...file}) => {
    const sha256=await digest(bytes);progress?.(10+50*(++hashed)/files.length);
    return { ...original.files?.find((f: any) => f.id === file.id), ...file, size: bytes.length, sha256 };
  }));
  const snapshotIds=[p.targets.app.profile?.fileId,p.targets.master.profile?.fileId,...(Array.isArray(p.editor.templateUses)?p.editor.templateUses.filter(validTemplateUse).map(use=>use.snapshotFileId):[])].filter((id):id is string=>!!id);
  const missingSnapshots=[...new Set(snapshotIds.filter(id=>!p.files.some(f=>f.id===id)))];
  const manifest: Manifest = {
    ...original, format: FORMAT, formatVersion: FORMAT_VERSION, projectSchemaVersion: PROJECT_SCHEMA_VERSION,
    createdWith: original.createdWith || { name: 'ROCOS Configurator', version }, lastSavedWith: { name: 'ROCOS Configurator', version },
    project: { ...original.project, id: p.id, name: p.name, description: p.description, revision: p.revision, createdAt: p.createdAt, modifiedAt: p.modifiedAt },
    snapshotId: uid(), targets: p.targets, entrypoints: p.entrypoints, files: index,
    modules: moduleSnapshots({ ...p, files }, registry),
    references: p.references, packageMap: p.packageMap,
    portability: { state: p.references.some(r => r.state !== 'internal')||missingSnapshots.length ? 'incomplete' : 'complete', unresolved: p.references.filter(r => r.state !== 'internal'),missingSnapshots },
    editorStateFileId: stateId,
  };
  validateManifest(manifest);
  progress?.(65);
  const packed = packZip(new Map([...files.map(f => [f.path, f.bytes] as const), ['rocos-project.json', utf8.encode(JSON.stringify(manifest, null, 2))]]));
  progress?.(75);
  await openProject(packed, LIMITS, registry, value=>progress?.(75+value*.25)); // Validate the bytes actually handed to the file adapter.
  return packed;
}
export interface ArchiveSummary { name: string; nameText?:MessageTemplate; formatVersion: number; projectSchemaVersion: number; files: { path: string; size: number }[] }
export type ArchiveInspection = { mode: 'editable'; project: Project; migration?: MigrationReport } | { mode: 'readonly'; original: Uint8Array; reason: string; reasonText?:MessageTemplate; summary: ArchiveSummary };
export async function inspectProjectArchive(bytes: Uint8Array, limits: ArchiveLimits = LIMITS, registry: ModuleRegistry = modules, progress?:ArchiveProgress): Promise<ArchiveInspection> {
  progress?.(5);
  const contents = unpackZip(bytes, limits);
  progress?.(20);
  const manifestBytes = contents.get('rocos-project.json');
  assert(manifestBytes && manifestBytes.length <= limits.manifest, msg("缺少工程 manifest"));
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  assert(object(raw) && raw.format === FORMAT, msg("不是 ROCOS 工程文件"));
  assert(Number.isSafeInteger(raw.formatVersion) && raw.formatVersion > 0 && Number.isSafeInteger(raw.projectSchemaVersion) && raw.projectSchemaVersion > 0, msg("工程版本声明无效"));
  const readonly = (reason: MessageInput): ArchiveInspection => ({ mode: 'readonly', original: new Uint8Array(bytes), reason:messageFields(reason).message, reasonText:messageFields(reason).text, summary: {
    name: typeof raw.project?.name === 'string' ? raw.project.name : '未识别工程',
    ...(typeof raw.project?.name==='string'?{}:{nameText:msg('未识别工程').text}),formatVersion: raw.formatVersion, projectSchemaVersion: raw.projectSchemaVersion,
    files: [...contents].map(([path, data]) => ({ path, size: data.length })),
  } });
  const migrations = projectMigrations(limits);
  if (raw.formatVersion !== FORMAT_VERSION || !migrations.supports(raw.projectSchemaVersion)) return readonly(msg("工程格式版本不受支持；仅展示 ZIP 摘要，未按该版本契约校验，不重新打包"));
  const payload = new Map(contents); payload.delete('rocos-project.json');
  let prepared: MigrationData = { manifest: raw, files: payload }, migration: MigrationReport | undefined;
  // Current archives need no additional copies of potentially large mesh data.
  if (raw.projectSchemaVersion !== PROJECT_SCHEMA_VERSION) {
    const result = await migrations.prepare(prepared); prepared = result.data; migration = result.report;
  }
  validateManifest(prepared.manifest); const manifest = prepared.manifest;
  const files = await readArchiveFiles(manifest, prepared.files, limits, progress);
  const unsupported = manifest.modules.filter(m => !registry.get(m.id, m.version));
  const coreIds = [manifest.entrypoints.master.fileId, manifest.entrypoints.master.eniFileId, manifest.entrypoints.app, manifest.entrypoints.urdf, manifest.entrypoints.hardware, manifest.entrypoints.binding, manifest.editorStateFileId];
  const required = unsupported.filter(m => m.required || m.fileIds.some(id => coreIds.includes(id)) || m.stateFileIds?.some(id => coreIds.includes(id)));
  const unknownCore = files.filter(f => coreIds.includes(f.id) && !fileModule({ modules: manifest.modules }, f, registry));
  if (unknownCore.length && !required.length) return readonly(msg("核心入口模块不受支持：{v0}；仅保留原包", {v0:String(unknownCore.map(f => f.owner).join('、'))}));
  if (required.length) return readonly(msg("必要模块或核心入口不受支持：{v0}；保留原包，不使用当前序列化器重新保存", {v0:String(required.map(m => `${m.id} v${m.version}`).join('、'))}));
  for (const file of files) {
    const adapter = fileModule({ modules: manifest.modules }, file, registry);
    if (adapter && !manifest.modules.some(m => m.stateFileIds?.includes(file.id))) assert(adapter.role === file.role, msg("模块声明与文件角色不一致：{v0}", {v0:String(file.path)}));
  }
  const stateFile = files.find(f => f.id === manifest.editorStateFileId)!;
  const editor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateFile.bytes));
  assert(object(editor) && object(editor.buffers) && object(editor.confirmations), msg("编辑状态无效"));
  assert(validConfiguration(editor.configuration,files,manifest.entrypoints.master),msg('模块配置状态无效'));
  if(editor.templateUses!==undefined)assert(Array.isArray(editor.templateUses)&&editor.templateUses.every(validTemplateUse),msg("模板使用记录无效"));
  if (editor.notices !== undefined) assert(Array.isArray(editor.notices) && editor.notices.every((n: unknown) => object(n) && files.some(f => f.id === n.fileId) && typeof n.message === 'string'), msg("复核记录无效"));
  for (const [id, buffer] of Object.entries(editor.buffers)) assert(files.some(f => f.id === id && f.role !== 'eni') && object(buffer) && typeof buffer.text === 'string' && typeof buffer.baseHash === 'string', msg("编辑缓冲区无效"));
  const project: Project = { id: manifest.project.id, name: manifest.project.name, description: manifest.project.description, revision: manifest.project.revision, createdAt: manifest.project.createdAt, modifiedAt: manifest.project.modifiedAt, snapshotId: manifest.snapshotId, targets: manifest.targets, entrypoints: manifest.entrypoints, references: manifest.references, packageMap: manifest.packageMap, editor: editor as Project['editor'], files: files.filter(f => f.id !== manifest.editorStateFileId), modules: manifest.modules, archiveMetadata: structuredClone(manifest) };
  // Also cover unsupported owners omitted from an otherwise legal module list.
  assert(!unsupportedRequired(project, registry).length, msg("必要模块不受支持"));
  progress?.(100);
  return { mode: 'editable', project, ...(migration ? { migration } : {}) };
}
export async function openProject(bytes: Uint8Array, limits: ArchiveLimits = LIMITS, registry: ModuleRegistry = modules, progress?:ArchiveProgress): Promise<Project> {
  const inspection = await inspectProjectArchive(bytes, limits, registry, progress);
  if (inspection.mode === 'readonly') throw new MessageError({message:inspection.reason,text:inspection.reasonText});
  return inspection.project;
}

/** Shared by ordinary opening and every registered migration schema validator. */
async function readArchiveFiles(manifest: Manifest, contents: Map<string, Uint8Array>, limits: ArchiveLimits, progress?: ArchiveProgress): Promise<ProjectFile[]> {
  assert(contents.size === manifest.files.length, msg("存在未登记或缺失文件"));
  const manifestSize = utf8.encode(JSON.stringify(manifest)).length;
  assert(manifestSize <= limits.manifest && contents.size + 1 <= limits.entries, msg("迁移后工程索引超过限额"));
  assert([...contents.values()].every(bytes => bytes.length <= limits.file) && [...contents.values()].reduce((total, bytes) => total + bytes.length, manifestSize) <= limits.total, msg("工程文件超过限额"));
  let hashed = 0;
  return Promise.all(manifest.files.map(async f => {
    const data = contents.get(f.path); assert(data && data.length === f.size, msg("文件缺失或长度不符：{v0}", {v0:String(f.path)}));
    assert(await digest(data) === f.sha256, msg("文件 SHA-256 不匹配：{v0}", {v0:String(f.path)}));
    progress?.(30 + 60 * (++hashed) / manifest.files.length);
    return { id: f.id, path: f.path, role: f.role, owner: f.owner, encoding: f.encoding, bytes: data };
  }));
}

function projectMigrations(limits: ArchiveLimits): MigrationRegistry {
  // v1 is the first published schema. Add real historical validators and
  // adjacent pure-data transforms here when a model upgrade is introduced.
  // Never relabel arbitrary archives or manufacture a pre-v1 history.
  return new MigrationRegistry(PROJECT_SCHEMA_VERSION, [{ version: 1, validate: async data => {
    validateManifestV1(data.manifest);
    await readArchiveFiles(data.manifest, data.files, limits);
  } }], []);
}
