import { m as msg, MessageError, type MessageTemplate } from '../project/messages';
import { isMap, isScalar, type Document } from 'yaml';
import { yamlDocument, readYaml } from './yaml';
import { nativeInt, nativeNode } from '../hardware/schema';
import { resolvePath } from '../project/paths';
import { fileById, textOf, type Project, type ProjectFile } from '../project/types';

// rocos-app 7093bcd: AppConfig::load/validate and Robot::Config.
export const appDefaults={http_host:'0.0.0.0',http_port:8080,http_control_ttl_seconds:300,
  scripts:'scripts',web_root:'../web',robot:{hardware_config:'hardware_talon_config.yaml',ecat_id:0,
    urdf:'robot.urdf',base_link:'base_link',tip_link:'link_7',joint_binding:'joint_binding.yaml',payload:'payload.yaml'}};
const integers:[string[],number,number][]=[[['http_port'],1,65535],[['http_control_ttl_seconds'],1,2147483647],[['robot','ecat_id'],0,2147483647]];
const strings=[...['http_host','scripts','web_root'].map(k=>[k]),...['hardware_config','urdf','base_link','tip_link','joint_binding','payload'].map(k=>['robot',k])];
export function robotConfigFile(p:Project):ProjectFile|undefined {
  const app=fileById(p,p.entrypoints.app);if(!app)return;
  let raw:any;try{raw=readYaml(textOf(app));}catch{return app;}
  if(typeof raw?.robot_config!=='string'||!raw.robot_config)return app;
  const ref=p.references.find(r=>r.sourceFileId===app.id&&r.field==='robot_config'&&r.original===raw.robot_config&&r.state==='internal');
  return fileById(p,ref?.targetFileId)??p.files.find(f=>f.path===resolvePath(app.path,raw.robot_config));
}
export function robotField(p:Project,key:string):(string|number)[] {return robotConfigFile(p)?.role==='app.robot'?[key]:['robot',key];}
export function appDocument(file:ProjectFile,project?:Project) {
  const doc=yamlDocument(textOf(file));if(!isMap(doc.contents))throw new MessageError(msg("APP 启动配置必须为映射"));
  const raw=doc.toJS({maxAliasCount:100});
  if(raw.schema_version!==undefined||raw.robot_config!==undefined||raw.device_config!==undefined){
    const diagnostics:{field:string;message:string;text?:MessageTemplate}[]=[];
    if(Number(raw.schema_version)!==1)diagnostics.push({field:'schema_version',message:'schema_version 必须为 1'});
    for(const key of ['robot_config','device_config'])if(typeof raw[key]!=='string'||!raw[key])diagnostics.push({field:key,message:`${key} 必须为非空路径`});
    const allowed=['schema_version','robot_config','device_config','user_config','http_host','http_port','http_control_ttl_seconds','scripts','web_root','tool_library','logging','diagnostics'];
    for(const key of Object.keys(raw))if(!allowed.includes(key))diagnostics.push({field:key,message:`未知 APP 字段：${key}`});
    const robotFile=project&&robotConfigFile(project);
    const robot=robotFile&&robotFile.id!==file.id?readYaml(textOf(robotFile)):{};
    if(robotFile&&robotFile.id!==file.id)robot.ecat_id=nativeInt(yamlDocument(textOf(robotFile)),['ecat_id']);
    const data:Record<string,any>={...appDefaults,...raw,robot};
    for(const [path,min,max] of integers.filter(([path])=>path.length===1)){
      const key=path[0];data[key]=nativeInt(doc,path,(appDefaults as Record<string,any>)[key]);
      if(!Number.isInteger(data[key])||data[key]<min||data[key]>max)diagnostics.push({field:key,message:`${key} 必须为 ${min}–${max} 范围内的原生整数`});
    }
    for(const [key] of strings.filter(path=>path.length===1)){
      const node=nativeNode(doc,[key]);
      if(node!==undefined){data[key]=isScalar(node)&&node.value!==null?String(node.source??node.value):undefined;}
      if(typeof data[key]!=='string'||!data[key])diagnostics.push({field:key,...msg('{v0} 必须为非空字符串标量',{v0:key})});
    }
    if(project){
      const devicePath=resolvePath(file.path,raw.device_config??''),deviceFile=project.files.find(f=>f.path===devicePath);
      if(deviceFile){const device=readYaml(textOf(deviceFile));if(device?.expected_robot?.name!==robot?.name||String(device?.expected_robot?.package_version)!==String(robot?.package_version))diagnostics.push({field:'device_config',message:'设备 expected_robot 与机器人型号/版本不匹配'});}
    }
    return {doc,data,diagnostics};
  }
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
