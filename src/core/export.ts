import { configuration } from './project/configuration';
import { m as msg, MessageError } from './project/messages';
import { type Project, type ProjectFile, type FileReference, fileById, textOf, utf8 } from './project/types';
import { packZip } from './project/zip';
import { checkPaths, relativePath } from './project/paths';
import { activeFileIds, collectReferences, elements } from './project/references';
import { modules } from './modules';
import type { ModuleRegistry } from './modules/registry';
import { fileModule } from './modules/project';
import { validateProject } from './validation';
export interface RuntimePlan {
  files: { path: string; bytes: Uint8Array; fileId?: string }[];
  rewrites: { fileId: string; field: string; from: string; to: string }[];
  external: FileReference[];
}
const toolRoles = new Set(['editor-state', 'profile', 'template']);
export function planRuntime(project: Project, registry: ModuleRegistry = modules): RuntimePlan {
  const p = structuredClone(project), refs = collectReferences(p, registry), active = activeFileIds(p, refs, registry);
  const errors = validateProject(p, registry).filter(d => d.severity === 'error');
  if (errors.length) throw new MessageError(msg("运行配置仍有 {v0} 项错误，请先修复。", {v0:String(errors.length)}));
  const plan: RuntimePlan = { files: [], rewrites: [], external: refs.filter(r => active.has(r.sourceFileId) && r.state === 'external') };
  const paths = new Map(p.files.map(f => [f.id, f.path]));
  const master = configuration(p).enabled.bus?fileById(p, p.entrypoints.master.fileId):undefined;
  if(master)paths.set(master.id, `${master.path.split('/').slice(0, -1).join('/')}${master.path.includes('/') ? '/' : ''}${p.entrypoints.master.kind}.yaml`);
  for (const file of p.files.filter(f => active.has(f.id))) {
    if (toolRoles.has(file.role) || file.path.startsWith('project-data/')) throw new MessageError(msg("运行依赖指向工具元数据：{v0}", {v0:String(file.path)}));
    const changes: { ref: FileReference; value: string }[] = [];
    for (const ref of refs.filter(r => r.sourceFileId === file.id && r.state === 'internal')) {
      const target = ref.kind === 'directory' ? ref.targetPath : ref.targetFileId && paths.get(ref.targetFileId);
      if (!target) throw new MessageError(msg("资源未解析：{v0}", {v0:String(ref.original)}));
      let value = relativePath(paths.get(file.id)!, target);
      if (ref.uri) value = value.split('/').map(encodeURIComponent).join('/');
      if (value !== ref.original) { changes.push({ ref, value }); plan.rewrites.push({ fileId: file.id, field: ref.field, from: ref.original, to: value }); }
    }
    const adapter = fileModule(p, file, registry);
    if (!adapter) throw new MessageError(msg("运行依赖模块不受支持：{v0}", {v0:String(file.path)}));
    if (adapter.capabilities.readonly && changes.length) throw new MessageError(msg("只读文件不能改写：{v0}", {v0:String(file.path)}));
    const outputs = adapter.export(adapter.parse(file), { project: p, file, path: paths.get(file.id)!, rewrites: changes.map(({ ref, value }) => ({ field: ref.field, value })) });
    if (!outputs.some(o => o.path === paths.get(file.id))) throw new MessageError(msg("模块没有输出计划内文件：{v0}", {v0:String(file.path)}));
    for (const output of outputs) {
      if (output.path.startsWith('project-data/') || output.path === 'rocos-project.json') throw new MessageError(msg("模块不能导出工具元数据"));
      if (file.role === 'eni' && (output.path !== paths.get(file.id) || output.bytes.length !== file.bytes.length || output.bytes.some((v, i) => v !== file.bytes[i]))) throw new MessageError(msg("ENI 输出必须与原始字节一致"));
      plan.files.push(output);
    }
  }
  const notes = ['ROCOS 运行配置包', '', `主站：${master?paths.get(master.id):'未启用'}`, `APP：${paths.get(p.entrypoints.app!)}`, '',
    '配置路径按文件所在目录解析。请按消费端启动参数指定主站配置文件。',
    '仅通过静态检查；消费端、SDK 和实机检查仍需在目标环境执行。',
    ...(plan.external.length ? ['', '以下资源由目标环境提供，必须按原路径准备：', ...plan.external.map(r => `${paths.get(r.sourceFileId)} | ${r.field} | ${r.original}`)] : ['', '已纳入所有已识别的活动资源依赖。']),
    '', '脚本、HMI 及其他附件按原样保留，其内部动态加载逻辑未做语义校验。',
  ];
  plan.files.push({ path: 'ROCOS-DEPLOYMENT.txt', bytes: utf8.encode(notes.join('\n') + '\n') });
  checkPaths(plan.files.map(f => f.path)); return plan;
}
export function prepareRuntime(p: Project, registry: ModuleRegistry = modules) {
  const plan = planRuntime(p, registry); return { plan, bytes: packZip(new Map(plan.files.map(f => [f.path, f.bytes]))) };
}
export function exportRuntime(p: Project, registry: ModuleRegistry = modules): Uint8Array { return prepareRuntime(p, registry).bytes; }
