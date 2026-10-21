import definitions from '../../../templates/profiles/targets.v1.json' with {type:'json'};
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
export interface ProfileStatus { supported:boolean; legacy:boolean; message:string; definition?:ProfileDefinition }
export function targetStatus(p:Project,slot:'app'|'master'):ProfileStatus{
  const kind=slot==='app'?'app':p.entrypoints.master.kind,definition=definitions[kind],target=p.targets[slot];
  const fail=(message:string):ProfileStatus=>({supported:false,legacy:false,message});
  if(!definition||!target||target.version!==definition.target.version||target.configVersion!==definition.target.configVersion||target.abi!==definition.target.abi)return fail(`${slot==='app'?'APP':'主站'}目标规则不受支持；当前内置基线为 ${definition?.target.version||'未知'}，不能按其他版本宣称验证通过`);
  const ref=target.profile;
  if(!ref)return {supported:true,legacy:true,definition,message:`使用内置 ${definition.id} v${definition.version}；此工程尚未留存规则快照`};
  if(ref.id!==definition.id||ref.version!==definition.version)return fail(`目标规则 ${ref.id} v${ref.version} 没有对应适配器`);
  const file=fileById(p,ref.fileId);
  if(!file||file.role!=='profile'||file.owner!=='profile')return fail(`目标规则快照缺失或用途不符：${ref.id}`);
  if(file.bytes.length>256*1024)return fail(`目标规则快照超过 256 KiB 解释限额：${ref.id}`);
  try{if(canonicalData(JSON.parse(textOf(file)))!==canonicalData(definition))return fail(`目标规则快照与受支持的 ${ref.id} v${ref.version} 不一致；不会执行归档中的规则代码或替换为当前规则`);}
  catch{return fail(`目标规则快照无法解析：${ref.id}`);}
  return {supported:true,legacy:false,definition,message:`${definition.id} v${definition.version} · ${target.version} · 规则快照一致`};
}
export function attachProfile(p:Project,slot:'app'|'master',separate=false){
  const kind=slot==='app'?'app':p.entrypoints.master.kind,definition=profileDefinition(kind),status=targetStatus(p,slot);
  if(!status.supported)throw new Error(status.message);
  if(!status.legacy)return;
  const path=`project-data/profiles/${definition.id}.v${definition.version}${separate?'.'+uid():''}.json`;
  let file=p.files.find(f=>f.path===path);
  if(file){
    if(file.role!=='profile'||file.owner!=='profile'||file.bytes.length>256*1024||canonicalData(JSON.parse(textOf(file)))!==canonicalData(definition))throw new Error(`规则快照路径已被其他内容占用：${path}`);
  }else{file={id:uid(),path,role:'profile',owner:'profile',encoding:'utf-8',bytes:utf8.encode(JSON.stringify(definition,null,2)+'\n')};p.files.push(file);}
  p.targets[slot].profile={id:definition.id,version:definition.version,fileId:file.id};
}
export function validateProfiles(p:Project):Diagnostic[]{
  return (['app','master'] as const).flatMap(slot=>{
    const status=targetStatus(p,slot);
    return status.supported&&!status.legacy?[]:[{code:status.supported?'target.snapshot.missing':'target.unsupported',severity:status.supported?'warning':'error',message:status.message,fileId:p.targets[slot]?.profile?.fileId}];
  });
}
