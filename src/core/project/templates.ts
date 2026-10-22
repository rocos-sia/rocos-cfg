import zeroerr from '../../../templates/devices/igh-drive-zeroerr.v1.json' with {type:'json'};
import drive from '../../../templates/devices/igh-drive-talon.v1.json' with {type:'json'};
import ftSensor from '../../../templates/devices/igh-ft-xjc.v1.json' with {type:'json'};
import io from '../../../templates/devices/igh-io-ax58200.v1.json' with {type:'json'};
import { m as msg, messageFields, MessageError, type MessageInput } from './messages';
import starter from '../../../templates/projects/starter.v2.json' with {type:'json'};
import starterV1 from '../../../templates/projects/starter.v1.json' with {type:'json'};
import robot from '../../../templates/robots/two-axis.v2.json' with {type:'json'};
import robotV1 from '../../../templates/robots/two-axis.v1.json' with {type:'json'};
import device from '../../../templates/devices/igh-discovery.v1.json' with {type:'json'};
import teaching from '../../../templates/projects/teaching.v2.json' with {type:'json'};
import teachingV1 from '../../../templates/projects/teaching.v1.json' with {type:'json'};
import talon from '../../../templates/projects/talon.v1.json' with {type:'json'};
import { canonicalData, targetStatus } from './profiles';
import { fileById, textOf, uid, utf8, type Diagnostic, type Project, type EditorState } from './types';
type TemplateUse=NonNullable<EditorState['templateUses']>[number];
export function validTemplateUse(value:unknown):value is TemplateUse{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as TemplateUse;
  const params=(p:unknown)=>!!p&&typeof p==='object'&&!Array.isArray(p)&&Object.values(p).every(x=>typeof x==='string'||typeof x==='number'&&Number.isFinite(x));
  return [v.id,v.templateId,v.snapshotFileId,v.appliedAt].every(x=>typeof x==='string'&&!!x)&&Number.isSafeInteger(v.version)&&v.version>0&&Number.isFinite(Date.parse(v.appliedAt))&&params(v.parameters)&&params(v.overrides)&&Array.isArray(v.outputs)&&v.outputs.every(x=>typeof x==='string');
}
export const starterData=()=>structuredClone(starter.data);
export const starterTemplate=()=>structuredClone(starter);
export const robotTemplate=()=>structuredClone(robot);
export const devicePresets = { 'drive-talon': drive, 'drive-zeroerr': zeroerr, 'ft-xjc': ftSensor, 'io-ax58200': io };
export type DevicePreset = 'blank' | keyof typeof devicePresets;
export const deviceTemplate=(preset:DevicePreset='blank')=>structuredClone(preset==='blank'?device:devicePresets[preset]);
export const teachingTemplate=()=>structuredClone(teaching);
export const talonTemplate=()=>structuredClone(talon);
type Definition=typeof starter|typeof robot|typeof device|typeof teaching|typeof talon|(typeof devicePresets)[keyof typeof devicePresets];
export function recordTemplate(p:Project,definition:Definition,parameters:Record<string,string|number>,outputs:string[]){
  for(const slot of ['app','master'] as const){const status=targetStatus(p,slot);if(!status.supported)throw new MessageError(status);if(!definition.profiles.includes(`${status.definition!.id}@${status.definition!.version}`))throw new MessageError(msg("模板不适用于当前目标规则"));}
  const path=`project-data/templates/${definition.id}.v${definition.version}.json`,bytes=utf8.encode(JSON.stringify(definition,null,2)+'\n');
  let file=p.files.find(f=>f.path===path);
  if(file){if(file.role!=='template'||file.owner!=='template'||file.bytes.length!==bytes.length||file.bytes.some((b,i)=>b!==bytes[i]))throw new MessageError(msg("模板快照已存在不同内容：{v0}", {v0:String(path)}));}
  else{file={id:uid(),path,role:'template',owner:'template',encoding:'utf-8',bytes};p.files.push(file);}
  const overrides=Object.fromEntries(Object.entries(parameters).filter(([key,value])=>value!==(definition.defaults as Record<string,unknown>)[key]));
  (p.editor.templateUses??=[]).push({id:uid(),templateId:definition.id,version:definition.version,snapshotFileId:file.id,appliedAt:new Date().toISOString(),parameters:structuredClone(parameters),overrides,outputs:[...outputs]});
}
export function validateTemplates(p:Project):Diagnostic[]{
  const result:Diagnostic[]=[];
  if(p.editor.templateUses!==undefined&&!Array.isArray(p.editor.templateUses))return [{code:'template.state',severity:'error',...msg("模板使用记录格式不受支持")}];
  for(const use of p.editor.templateUses||[]){
    if(!validTemplateUse(use)){result.push({code:'template.state',severity:'error',...msg("模板使用记录无效")});continue;}
    const file=fileById(p,use.snapshotFileId),definition=[starter,starterV1,robot,robotV1,device,teaching,teachingV1,talon,...Object.values(devicePresets)].find(t=>t.id===use.templateId&&t.version===use.version);
    let message:MessageInput|undefined;
    if(!file||file.role!=='template')message=msg("实际使用的模板快照缺失：{v0} v{v1}", {v0:String(use.templateId), v1:String(use.version)});
    else if(file.bytes.length>1024*1024)message=msg("模板快照超过 1 MiB 解释限额：{v0}；保留原文件，不重新应用", {v0:String(use.templateId)});
    else try{
      const snapshot=JSON.parse(textOf(file));
      if(snapshot.id!==use.templateId||snapshot.version!==use.version)message=msg("模板快照与使用记录不一致");
      else if(definition&&canonicalData(snapshot)!==canonicalData(definition))message=msg("模板 {v0} v{v1} 与内置定义不同，仅保留历史数据，不重新应用", {v0:String(use.templateId), v1:String(use.version)});
      else if(!definition)message=msg("模板 {v0} v{v1} 不在当前库中；保留原配置与快照，不重新应用", {v0:String(use.templateId), v1:String(use.version)});
    }catch{message=msg("模板快照无法解析：{v0}", {v0:String(use.templateId)});}
    if(message)result.push({code:'template.snapshot',severity:'warning',...messageFields(message),fileId:use.snapshotFileId});
  }
  return result;
}
