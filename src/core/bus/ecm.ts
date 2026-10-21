import { isMap, isScalar, type Document } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { nativeInt, nativeNode } from '../hardware/schema';
import { textOf, type ProjectFile } from '../project/types';

// rocos-ecm e0e5e32, Main/Common/EcConfig.cpp. Values are interpreted
// using yaml-cpp's scalar rules, independently of YAML 1.2 JS conversion.
export const ecmDefaults = { id:0, eni:'eni7.xml', duration:0, cycle:1000, verbose:3,
  cpuidx:0, perf:1, auxclk:0, sp:null, log:'', flash:null, dcmmode:1,
  ctloff:false, link:2, instance:1, mode:1, state:'op', license:'',
  maxbusslaves:256, mbxsrv:null };
const ranges:Record<string,[number,number]>={id:[0,2147483647],duration:[0,2147483647],cycle:[1,2147483],verbose:[0,2147483647],cpuidx:[0,31],perf:[0,2],auxclk:[0,0],sp:[1,65535],flash:[0,65535],dcmmode:[0,5],link:[0,2],instance:[1,2147483647],mode:[0,1],maxbusslaves:[1,2147483647],mbxsrv:[1,65535]};
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
  if(!isMap(doc.contents)||!doc.contents.items.length)throw new Error('ECM 启动配置必须为非空映射');
  const raw=doc.toJS({maxAliasCount:100}),data:Record<string,any>={...ecmDefaults};
  const diagnostics:{field:string;message:string}[]=[];
  const report=(field:string,message:string)=>diagnostics.push({field,message});
  for(const key of Object.keys(raw))if(!Object.hasOwn(ecmDefaults,key))report(key,`ECM 不支持字段：${key}`);
  for(const [key,[min,max]] of Object.entries(ranges)) {
    if(optional.has(key)&&(raw[key]===undefined||raw[key]===null)){data[key]=null;continue;}
    const fallback=key==='cpuidx'?data.id:data[key];
    data[key]=nativeInt(doc,[key],fallback);
    if(!Number.isInteger(data[key])||data[key]<min||data[key]>max)report(key,`${key} 必须为 ${min}–${max} 范围内的原生整数`);
  }
  for(const key of ['eni','log','state','license'])if(Object.hasOwn(raw,key)) {
    data[key]=scalar(doc,key);
    if(data[key]===undefined)report(key,`${key} 必须为非 null 标量`);
  }
  if(Object.hasOwn(raw,'ctloff')) {
    data.ctloff=boolean(scalar(doc,'ctloff'));
    if(data.ctloff===undefined)report('ctloff','ctloff 必须为原生布尔值');
  }
  if(typeof data.state==='string'){
    data.state=data.state.toLowerCase();
    if(!['init','preop','safeop','op'].includes(data.state))report('state','state 必须为 init、preop、safeop 或 op');
  }
  if(data.eni==='')report('eni','eni 不能为空');
  for(const [key,max] of [['eni',255],['log',63],['license',63]] as const)if(typeof data[key]==='string'&&(data[key].includes('\0')||new TextEncoder().encode(data[key]).length>max))report(key,`${key} 不能包含 NUL，且不得超过 ${max} 字节；相对路径还需计入部署目录长度`);
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
