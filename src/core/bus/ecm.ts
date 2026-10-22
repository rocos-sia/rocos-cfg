import { m as msg, messageFields, MessageError, type MessageInput, type MessageTemplate } from '../project/messages';
import { isMap, isScalar, type Document } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { nativeInt, nativeNode } from '../hardware/schema';
import { textOf, type ProjectFile } from '../project/types';
import { ecmRules } from '../project/profiles';
export const ecmLinkDrivers = ecmRules.linkDrivers;

// rocos-ecm d85a6f3, Main/Common/EcConfig.cpp. Values are interpreted
// using yaml-cpp's scalar rules, independently of YAML 1.2 JS conversion.
export const ecmDefaults = { id:0, eni:'eni7.xml', duration:0, cycle:1000, verbose:3,
  cpuidx:0, perf:1, auxclk:0, sp:null, log:'', flash:null, dcmmode:1,
  ctloff:false, link:ecmRules.defaultLink, instance:1, mode:1, state:'op', license:'',
  maxbusslaves:256, mbxsrv:null };
const ranges:Record<string,[number,number]>={id:[0,2147483647],duration:[0,2147483647],cycle:[1,2147483],verbose:[0,2147483647],cpuidx:[0,31],perf:[0,2],auxclk:[0,0],sp:[1,65535],flash:[0,65535],dcmmode:[0,5],instance:[1,2147483647],mode:[0,1],maxbusslaves:[1,2147483647],mbxsrv:[1,65535]};
const optional=new Set(['sp','flash','mbxsrv']);
function scalar(doc:Document,key:string):string|undefined {
  const n=nativeNode(doc,[key]);return isScalar(n)&&n.value!==null?String(n.source??n.value):undefined;
}
function boolean(raw:string|undefined):boolean|undefined {
  // yaml-cpp accepts lower, upper and title case, but not arbitrary mixed case.
  if(raw===undefined||![raw.toLowerCase(),raw.toUpperCase(),raw[0]?.toUpperCase()+raw.slice(1).toLowerCase()].includes(raw))return undefined;
  if(['y','yes','true','on'].includes(raw.toLowerCase()))return true;
  if(['n','no','false','off'].includes(raw.toLowerCase()))return false;
}
export function ecmDocument(file:ProjectFile) {
  const doc=yamlDocument(textOf(file));
  if(!isMap(doc.contents)||!doc.contents.items.length)throw new MessageError(msg("ECM 启动配置必须为非空映射"));
  const raw=doc.toJS({maxAliasCount:100}),data:Record<string,any>={...ecmDefaults};
  const diagnostics:{field:string;message:string;text?:MessageTemplate}[]=[];
  const report=(field:string,message:MessageInput)=>diagnostics.push({field,...messageFields(message)});
  for(const key of Object.keys(raw))if(!Object.hasOwn(ecmDefaults,key))report(key,msg("ECM 不支持字段：{v0}", {v0:String(key)}));
  for(const [key,[min,max]] of Object.entries(ranges)) {
    if(optional.has(key)&&(raw[key]===undefined||raw[key]===null)){data[key]=null;continue;}
    const fallback=key==='cpuidx'?data.id:data[key];
    data[key]=nativeInt(doc,[key],fallback);
    if(!Number.isInteger(data[key])||data[key]<min||data[key]>max)report(key,msg("{v0} 必须为 {v1}–{v2} 范围内的原生整数", {v0:String(key), v1:String(min), v2:String(max)}));
  }
  for(const key of ['eni','log','state','license','link'])if(Object.hasOwn(raw,key)) {
    data[key]=scalar(doc,key);
    if(data[key]===undefined)report(key,msg("{v0} 必须为非 null 标量", {v0:String(key)}));
  }
  if(!ecmLinkDrivers.includes(data.link))report('link',msg('link 必须为 I8254x、I8255x、IntelGbe、IntelGbeRec 或 RTL8169（区分大小写）'));
  if(data.link==='RTL8169'){
    if(data.mode!==1)report('mode',msg('RTL8169 仅支持轮询模式（mode: 1）'));
    if(data.dcmmode===3)report('dcmmode',msg('RTL8169 不提供链路层参考时钟（dcmmode: 3）'));
  }
  if(Object.hasOwn(raw,'ctloff')) {
    data.ctloff=boolean(scalar(doc,'ctloff'));
    if(data.ctloff===undefined)report('ctloff',msg("ctloff 必须为原生布尔值"));
  }
  if(typeof data.state==='string'){
    data.state=data.state.toLowerCase();
    if(!['init','preop','safeop','op'].includes(data.state))report('state',msg("state 必须为 init、preop、safeop 或 op"));
  }
  if(data.eni==='')report('eni',msg("eni 不能为空"));
  for(const [key,max] of [['eni',255],['log',63],['license',63]] as const)if(typeof data[key]==='string'&&(data[key].includes('\0')||new TextEncoder().encode(data[key]).length>max))report(key,msg("{v0} 不能包含 NUL，且不得超过 {v1} 字节；相对路径还需计入部署目录长度", {v0:String(key), v1:String(max)}));
  return {doc,data,diagnostics};
}

// Preserve original scalar spelling before YAML 1.2 serialization. For example
// native 010 means 8, and an anchor may serve both integer and string fields.
// Quoting retains yaml-cpp conversions without changing shared alias meaning.
export function preserveEcmScalars(doc:Document) {
  if(!isMap(doc.contents))return;
  for(const pair of doc.contents.items){
    if(!isScalar(pair.key))continue;
    const node=nativeNode(doc,[String(pair.key.value)]);
    if(isScalar(node)&&node.value!==null){node.value=String(node.source??node.value);node.type='QUOTE_DOUBLE';node.format=undefined;}
  }
}
