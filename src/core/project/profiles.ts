import { m as msg, messageFields, MessageError, type MessageInput, type MessageTemplate } from './messages';
import legacyDefinitions from '../../../templates/profiles/targets.v1.json' with {type:'json'};
import namedEcm from '../../../templates/profiles/ecm.v2.json' with {type:'json'};
const definitions = {...legacyDefinitions, ecm: namedEcm};
import { fileById, textOf, uid, utf8, type Diagnostic, type MasterKind, type Project, type TargetProfile } from './types';

export type ProfileKind=MasterKind|'app';
export type ProfileDefinition=typeof definitions[ProfileKind];
export function canonicalData(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonicalData).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalData((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function profileDefinition(kind:ProfileKind):ProfileDefinition{return structuredClone(definitions[kind]);}
export const busRules=(kind:MasterKind)=>definitions[kind].rules;
export const ighRules=definitions.igh.rules;
export const ecmRules=definitions.ecm.rules;
export const appRules=definitions.app.rules;
export const baseTarget=(kind:ProfileKind):TargetProfile=>structuredClone(definitions[kind].target);
export interface ProfileStatus { supported:boolean; legacy:boolean; message:string; text?:MessageTemplate; definition?:ProfileDefinition }
export function targetStatus(p:Project,slot:'app'|'master'):ProfileStatus{
  const kind=slot==='app'?'app':p.entrypoints.master.kind,definition=definitions[kind],target=p.targets[slot];
  const fail=(message:MessageInput):ProfileStatus=>({supported:false,legacy:false,...messageFields(message)});
  if(!definition||!target||target.version!==definition.target.version||target.configVersion!==definition.target.configVersion||target.abi!==definition.target.abi)return fail(msg("{v0}目标规则不受支持；当前内置基线为 {v1}，不能按其他版本宣称验证通过", {v0:(slot==='app' ? "APP" : msg("主站").text), v1:String(definition?.target.version||'未知')}));
  const ref=target.profile;
  if(!ref)return {supported:true,legacy:true,definition,...msg("使用内置 {v0} v{v1}；此工程尚未留存规则快照", {v0:String(definition.id), v1:String(definition.version)})};
  if(ref.id!==definition.id||ref.version!==definition.version)return fail(msg("目标规则 {v0} v{v1} 没有对应适配器", {v0:String(ref.id), v1:String(ref.version)}));
  const file=fileById(p,ref.fileId);
  if(!file||file.role!=='profile'||file.owner!=='profile')return fail(msg("目标规则快照缺失或用途不符：{v0}", {v0:String(ref.id)}));
  if(file.bytes.length>256*1024)return fail(msg("目标规则快照超过 256 KiB 解释限额：{v0}", {v0:String(ref.id)}));
  try{if(canonicalData(JSON.parse(textOf(file)))!==canonicalData(definition))return fail(msg("目标规则快照与受支持的 {v0} v{v1} 不一致；不会执行归档中的规则代码或替换为当前规则", {v0:String(ref.id), v1:String(ref.version)}));}
  catch{return fail(msg("目标规则快照无法解析：{v0}", {v0:String(ref.id)}));}
  return {supported:true,legacy:false,definition,...msg("{v0} v{v1} · {v2} · 规则快照一致", {v0:String(definition.id), v1:String(definition.version), v2:String(target.version)})};
}
export function attachProfile(p:Project,slot:'app'|'master',separate=false){
  const kind=slot==='app'?'app':p.entrypoints.master.kind,definition=profileDefinition(kind),status=targetStatus(p,slot);
  if(!status.supported)throw new MessageError(status);
  if(!status.legacy)return;
  const path=`project-data/profiles/${definition.id}.v${definition.version}${separate?'.'+uid():''}.json`;
  let file=p.files.find(f=>f.path===path);
  if(file){
    if(file.role!=='profile'||file.owner!=='profile'||file.bytes.length>256*1024||canonicalData(JSON.parse(textOf(file)))!==canonicalData(definition))throw new MessageError(msg("规则快照路径已被其他内容占用：{v0}", {v0:String(path)}));
  }else{file={id:uid(),path,role:'profile',owner:'profile',encoding:'utf-8',bytes:utf8.encode(JSON.stringify(definition,null,2)+'\n')};p.files.push(file);}
  p.targets[slot].profile={id:definition.id,version:definition.version,fileId:file.id};
}
export function validateProfiles(p:Project,slots: ('app'|'master')[]=['app','master']):Diagnostic[]{
  return slots.flatMap(slot=>{
    const status=targetStatus(p,slot);
    return status.supported&&!status.legacy?[]:[{code:status.supported?'target.snapshot.missing':'target.unsupported',severity:status.supported?'warning':'error',...messageFields(status),fileId:p.targets[slot]?.profile?.fileId}];
  });
}
