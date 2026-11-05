import { m as msg, MessageError } from '../core/project/messages';
import { fileAccess, browserDownload } from './file-access';
import { unpackZip, LIMITS, type ArchiveLimits } from '../core/project/zip';
import { robotConfigFile } from '../core/documents/app-config';
import { configuration } from '../core/project/configuration';
import { fileById, type Project } from '../core/project/types';
import { applyImport, inspectImport, type ImportPlan, type ImportTarget } from '../core/project/import';
export async function download(bytes: Uint8Array, filename: string, type='application/octet-stream') {
  if(fileAccess().kind==='browser'){browserDownload(bytes,filename,type);return;}
  const access=fileAccess(),result=await access.write(bytes,filename);
  if(result?.kind==='written')await access.release(result.handle);
}
export async function prepareImport(p: Project, input: File[], limits: ArchiveLimits = LIMITS, target?: ImportTarget): Promise<ImportPlan> {
  const all = new Map<string, Uint8Array>(); let total = 0;
  if (input.length > limits.entries) throw new MessageError(msg("导入文件数量超过限额"));
  const insert = (path: string, bytes: Uint8Array) => { if (all.has(path)) throw new MessageError(msg("导入路径重复：{v0}", {v0:String(path)})); if (bytes.length > limits.file || total + bytes.length > limits.total || all.size + 1 > limits.entries) throw new MessageError(msg("导入文件超过限额：{v0}", {v0:String(path)})); total += bytes.length; all.set(path, bytes); };
  for (const f of input) {
    const zipped = f.name.toLowerCase().endsWith('.zip');
    if (f.size > (zipped ? limits.total + 1024 ** 2 : limits.file)) throw new MessageError(msg("导入文件超过限额：{v0}", {v0:String(f.name)}));
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (zipped) for (const [path, data] of unpackZip(bytes, { ...limits, total: limits.total - total, entries: limits.entries - all.size })) insert(path, data);
    else insert(f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name, bytes);
  }
  const single = input.length === 1 && !input[0].name.toLowerCase().endsWith('.zip') && !input[0].webkitRelativePath;
  const plan = inspectImport(p, all, single, undefined, target);
  if (target) {
    const robot=robotConfigFile(p),urdf=fileById(p,p.entrypoints.urdf);
    const base=(robot?.role==='app.robot'?robot:urdf)?.path.split('/').slice(0,-1).join('/')??'robots/robot';
    const simulation=fileById(p,configuration(p).simulationFileId);
    const simBase=simulation?.path.split('/').slice(0,-1).join('/')??base+'/mjcf';
    const prefix = target === 'mjcf' ? (plan.files.some(f=>f.path.startsWith('mjcf/'))?base+'/':simBase+'/') : target === 'urdf' ? base+'/' : target === 'ecm' || target === 'igh' ? 'master/' : target === 'mujoco' ? simBase+'/' : target === 'app.payload' ? 'app/payloads/' : 'app/';
    plan.files.forEach(file => { file.path = prefix + file.path; });
    plan.matchUrdfMeshes = target === 'urdf';
  }
  return plan;
}
export async function importFiles(p: Project, input: File[]): Promise<Project> {
  return applyImport(p, await prepareImport(p, input));
}
export const filenameFor=(name:string)=> (name.replace(/[\\/:*?"<>|]/g,'_').trim()||'project')+'.rcproj';
