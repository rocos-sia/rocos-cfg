import { isMap, isSeq, parseDocument } from 'yaml';
import { app, ecm, igh } from '../documents/config-fields';
import { hardwareDocument, signals, isRecord, type HardwareType } from '../hardware/schema';
import { readYaml } from '../documents/yaml';
import { children, xmlDocument } from '../documents/xml';
import { targetStatus } from '../project/profiles';
import { collectReferences } from '../project/references';
import { fileById, textOf, type Project, type Diagnostic } from '../project/types';

export interface DiagnosticLocation { fileId:string; field?:string; route:'master'|'hardware'|'robot'|'app'; mode:'field'|'source'|'resource'; index?:number }
export function diagnosticLocation(p:Project,d:Diagnostic):DiagnosticLocation|undefined {
  const file=fileById(p,d.fileId);if(!file)return;
  const field=d.field,active=file.id===p.entrypoints.master.fileId;
  const route=active||file.id===p.entrypoints.master.eniFileId?'master':file.id===p.entrypoints.hardware||file.id===p.entrypoints.binding?'hardware':file.id===p.entrypoints.urdf?'robot':'app';
  const source:DiagnosticLocation={fileId:file.id,field,route,mode:'source'};
  if(p.editor.buffers[file.id]||!field)return source;
  try {
    if(d.code.startsWith('reference.')&&collectReferences(p).some(ref=>ref.sourceFileId===file.id&&ref.field===field))return {...source,mode:'resource',route:'app'};
    if(!isRecord(readYaml(textOf(file)))||active&&!targetStatus(p,'master').supported)return source;
    if((active?(p.entrypoints.master.kind==='igh'?igh:ecm):file.id===p.entrypoints.app?app:[]).some(spec=>spec.path===field))return {...source,mode:'field'};
    if(file.id===p.entrypoints.hardware){
      const match=/^hardware\.(\d+)(?:\.(.+))?$/.exec(field),index=match?Number(match[1]):-1;
      const device=hardwareDocument(file).devices[index];if(!isRecord(device))return source;
      const key=match?.[2],type=device.type as HardwareType;
      const ordinary=['id',...(type==='driver'?['joint_name','torque_source','transform.user_unit_name','transform.ratio','transform.cnt_per_unit','transform.torque_per_unit','transform.offset_pos_cnt',...['lower','upper','vel','acc','jerk','effort'].map(k=>'limit.'+k)]:type==='ft_sensor'?['fx','fy','fz','tx','ty','tz'].map(k=>'offset.'+k):type==='io'?['digital_in_channels','digital_out_channels','analog_in_channels','analog_out_channels']:[])];
      if(ordinary.includes(key!)||!key&&type==='driver'&&d.code==='hardware.confirmation'||(['inputs','outputs'] as const).some(group=>signals[type]?.[group].some(s=>key===group+'.'+s.key)))return {...source,mode:'field',index};
    }
    if(active&&p.entrypoints.master.kind==='igh'){
      const match=/^slaves\.(\d+)\.(.+)$/.exec(field);if(!match)return source;
      const index=Number(match[1]),slave=readYaml(textOf(file))?.slaves?.[index];if(!isRecord(slave))return source;
      const key=match[2];
      if(['name','dc_ref'].includes(key))return {...source,mode:'field',index};
      const pdo=/^(rx_pdos|tx_pdos)\.(\d+)\.(index|entries\.(\d+)\.(name|index|sub_index|bit_length))$/.exec(key);
      if(pdo&&isRecord(slave[pdo[1]]?.[Number(pdo[2])])&&(!pdo[4]||isRecord(slave[pdo[1]][Number(pdo[2])]?.entries?.[Number(pdo[4])])))return {...source,mode:'field',index};
      const sdo=/^init_commands\.(\d+)\.(name|index|sub_index|type|Type|value|Value)$/.exec(key),command=sdo&&slave.init_commands?.[Number(sdo[1])];
      if(sdo&&isRecord(command)&&(!['type','Type','value','Value'].includes(sdo[2])||Object.hasOwn(command,sdo[2])))return {...source,mode:'field',index};
    }
  }catch{ /* Invalid document shape is best repaired in the source editor. */ }
  return source;
}

export interface SourceRange { from:number; to:number; exact:boolean }
/** Paths are structural, never a text search: repeated keys and aliases stay distinct. */
export function diagnosticSourceRange(text:string,syntax:string,field?:string):SourceRange {
  if(syntax==='yaml'){
    const doc=parseDocument(text,{keepSourceTokens:true});
    if(doc.errors.length){const [from,to]=doc.errors[0].pos;return {from,to:Math.min(to,text.length),exact:false};}
    let node:any=doc.contents,keyNode:any;const parts=field?.split('.')||[];
    for(const part of parts){
      if(isMap(node)){const pair=node.items.find(pair=>String((pair.key as any)?.value)===part);if(!pair)return nodeRange(keyNode||node,false);keyNode=pair.key;node=pair.value;}
      else if(isSeq(node)&&/^\d+$/.test(part)){keyNode=undefined;const next=node.items[Number(part)];if(!next)return nodeRange(node,false);node=next;}
      else return nodeRange(node||keyNode,false);
    }
    return nodeRange(isMap(node)||isSeq(node)?keyNode||node:node||keyNode,!!field);
  }
  if(syntax==='xml'&&field){
    try {
      const doc=xmlDocument(text,true),parts=field.replace(/\[(\d+)\]/g,'.$1').split('.');let node:Element=doc.documentElement;
      if(parts[0]===node.localName)parts.shift();
      for(let i=0;i<parts.length;i++){const tag=parts[i],index=/^\d+$/.test(parts[i+1]||'')?Number(parts[++i]):0;const next=children(node,tag)[index];if(!next)return xmlRange(text,node,false);node=next;}
      return xmlRange(text,node,true);
    }catch{ /* Malformed XML still opens intact for repair. */ }
  }
  return {from:0,to:0,exact:false};
}
function nodeRange(node:any,exact:boolean):SourceRange {const range=node?.range;return range?{from:range[0],to:isMap(node)||isSeq(node)?range[0]+1:range[1],exact}:{from:0,to:0,exact:false};}
function xmlRange(text:string,node:Element,exact:boolean):SourceRange {
  const located=node as Element&{lineNumber:number;columnNumber:number};let from=0;
  const lines=/\r\n?|\n/g;for(let i=1;i<located.lineNumber;i++){const match=lines.exec(text);if(!match)return {from:0,to:0,exact:false};from=match.index+match[0].length;}
  from+=located.columnNumber-1;return {from,to:from+node.tagName.length+1,exact};
}
