import { m as msg, MessageError, type MessageTemplate } from '../project/messages';
import { isMap, isScalar, type Document } from 'yaml';
import { yamlDocument } from './yaml';
import { nativeInt, nativeNode } from '../hardware/schema';
import { textOf, type ProjectFile } from '../project/types';

// rocos-app 7093bcd: AppConfig::load/validate and Robot::Config.
export const appDefaults={http_host:'0.0.0.0',http_port:8080,http_control_ttl_seconds:300,
  scripts:'scripts',web_root:'../web',robot:{hardware_config:'hardware_talon_config.yaml',ecat_id:0,
    urdf:'robot.urdf',base_link:'base_link',tip_link:'link_7',joint_binding:'joint_binding.yaml',payload:'payload.yaml'}};
const integers:[string[],number,number][]=[[['http_port'],1,65535],[['http_control_ttl_seconds'],1,2147483647],[['robot','ecat_id'],0,2147483647]];
const strings=[...['http_host','scripts','web_root'].map(k=>[k]),...['hardware_config','urdf','base_link','tip_link','joint_binding','payload'].map(k=>['robot',k])];
export function appDocument(file:ProjectFile) {
  const doc=yamlDocument(textOf(file));if(!isMap(doc.contents))throw new MessageError(msg("APP 启动配置必须为映射"));
  const raw=doc.toJS({maxAliasCount:100});
  const robot=nativeNode(doc,['robot']);if(robot!==undefined&&!isMap(robot))throw new MessageError(msg("APP robot 必须为映射"));
  const data:Record<string,any>={...appDefaults,...raw,robot:{...appDefaults.robot,...raw.robot}};
  const diagnostics:{field:string;message:string;text?:MessageTemplate}[]=[];
  for(const [path,min,max] of integers){
    const key=path.at(-1)!,target=path.length===1?data:data.robot,defaults=path.length===1?appDefaults:appDefaults.robot;
    target[key]=nativeInt(doc,path,(defaults as Record<string,unknown>)[key] as number);
    if(!Number.isInteger(target[key])||target[key]<min||target[key]>max)diagnostics.push({field:path.join('.'),...msg("{v0} 必须为 {v1}–{v2} 范围内的原生整数", {v0:String(path.join('.')), v1:String(min), v2:String(max)})});
  }
  for(const path of strings){
    const node=nativeNode(doc,path),key=path.at(-1)!,target=path.length===1?data:data.robot;
    // Unlike ECM's explicit IsScalar guard, yaml-cpp as<string>() maps null
    // to the literal string "null". Preserve that consumer behavior.
    if(node!==undefined)target[key]=isScalar(node)?node.value===null?'null':String(node.source??node.value):undefined;
    if(typeof target[key]!=='string'||!target[key].length)diagnostics.push({field:path.join('.'),...msg("{v0} 必须为非空字符串标量", {v0:String(path.join('.'))})});
  }
  return {doc,data,diagnostics};
}
export function preserveAppScalars(doc:Document){
  for(const path of [...integers.map(([path])=>path),...strings]){
    const node=nativeNode(doc,path);
    if(isScalar(node)&&node.value!==null){node.value=String(node.source??node.value);node.type='QUOTE_DOUBLE';node.format=undefined;}
  }
}
