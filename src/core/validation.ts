import { m as msg, messageFields, errorMessage, type MessageInput } from './project/messages';
import { validateHardware } from './hardware/validation';
import { modules } from './modules';
import type { ModuleRegistry } from './modules/registry';
import { validateModules } from './modules/project';
import { buildBusCatalog } from './bus/catalog';
import { appDocument } from './documents/app-config';
import { controlChain } from './documents/urdf';
import { activeFileIds, collectReferences } from './project/references';
import { fileById, textOf, type Project, type Diagnostic } from './project/types';
import { validateProfiles } from './project/profiles';
import { validateTemplates } from './project/templates';
export function validateProject(p: Project, registry: ModuleRegistry = modules): Diagnostic[] {
  const bus = buildBusCatalog(p); const diagnostics = [...bus.diagnostics,...validateProfiles(p),...validateTemplates(p)];
  const add = (code: string, message: MessageInput, fileId?: string, field?: string, severity: Diagnostic['severity']='error') => diagnostics.push({code,...messageFields(message),fileId,field,severity});
  const references = collectReferences(p, registry), active = activeFileIds(p, references, registry);
  const expected = [{id:p.entrypoints.app,role:'app'}, {id:p.entrypoints.urdf,role:'urdf'}, {id:p.entrypoints.hardware,role:'hardware'}, {id:p.entrypoints.binding,role:'binding'}];
  for (const {id,role} of expected) if (!fileById(p,id) || fileById(p,id)?.role !== role) add('entrypoint.missing',msg("缺少有效的 {v0} 入口", {v0:String(role)}),id||undefined);
  diagnostics.push(...validateModules(p, active, registry));
  for(const notice of p.editor.notices || []) add('editor.review',notice,notice.fileId,undefined,'warning');
  for(const id of Object.keys(p.editor.buffers).filter(id => active.has(id))) add('editor.pending',msg("存在未应用的源码草稿"),id);
  for(const ref of references.filter(r => active.has(r.sourceFileId))) if(ref.state!=='internal') add('reference.'+ref.state,msg("{v0}：{v1} {v2}", {v0:String(ref.field), v1:String(ref.original), v2:(ref.state==='external' ? msg("由目标环境提供").text : msg("未找到").text)}),ref.sourceFileId,ref.field,ref.state==='external'?'warning':'error');
  for (const [sourceId, field, targetId] of [[p.entrypoints.app,'robot.urdf',p.entrypoints.urdf], [p.entrypoints.app,'robot.hardware_config',p.entrypoints.hardware], [p.entrypoints.app,'robot.joint_binding',p.entrypoints.binding], ...(p.entrypoints.master.kind==='ecm'?[[p.entrypoints.master.fileId,'eni',p.entrypoints.master.eniFileId]]:[])] as (string|null)[][]) {
    const ref=references.find(r=>r.sourceFileId===sourceId&&r.field===field);
    if(!ref||ref.state!=='internal'||ref.targetFileId!==targetId) add('reference.entrypoint',msg("{v0} 必须引用当前工程入口配置", {v0:String(field)}),sourceId||undefined,field||undefined);
  }
  let app:Record<string,any>|undefined;
  const appFile=fileById(p,p.entrypoints.app);
  try{if(appFile)app=appDocument(appFile).data;}catch{ /* Module validation reports malformed startup files. */ }
  if(app&&fileById(p,p.entrypoints.master.fileId)&&app.robot.ecat_id!==bus.masterId)add('app.master-id',msg("APP ecat_id 与主站 ID 不一致"),p.entrypoints.app!,'robot.ecat_id');
  const urdf=fileById(p,p.entrypoints.urdf);
  if(urdf && app) try {
    const chain=controlChain(textOf(urdf),app.robot?.base_link,app.robot?.tip_link);
    if(!chain.length) add('binding.empty',msg("控制链没有可动关节"),urdf.id);
    diagnostics.push(...validateHardware(p,bus,chain));
  } catch(e) { add('binding.chain',errorMessage(e,true),urdf.id); diagnostics.push(...validateHardware(p,bus)); }
  else diagnostics.push(...validateHardware(p,bus));
  add('validation.runtime',msg("消费端、SDK 与实机检查尚未执行"),undefined,undefined,'info');
  if(p.targets.app.abi==='unverified'||p.targets.master.abi==='unverified') add('target.abi',msg("主站与 APP 的 ABI 配对尚未验证"),undefined,undefined,'warning');
  return diagnostics;
}
