import { stringify } from 'yaml';
import type { ConfigModule } from './contracts';
import { readYaml, yamlDocument } from '../documents/yaml';
import { textOf, utf8 } from '../project/types';
import { relativePath, resolvePath } from '../project/paths';
import { appMasterConfig } from '../documents/app-package';
import { nativeInt } from '../hardware/schema';
import { collectReferences } from '../project/references';
const capabilities={readonly:false,generate:false,advancedEdit:true,desktop:false};
const refs=(value:any,keys:string[])=>keys.flatMap(field=>{
 const original=field.split('.').reduce((v,k)=>v?.[k],value);
 return typeof original==='string'&&original?[{field,original}]:[];
});
const module=(id:string,detect:(v:any,path:string)=>boolean,fields:string[]):ConfigModule=>({
 id,version:1,role:id,syntax:'yaml',capabilities,
 detect:f=>/\.ya?ml$/i.test(f.path)&&detect(readYaml(textOf(f)),f.path),parse:f=>readYaml(textOf(f)),
 validate:(v,{file})=>{
  const errors:string[]=[];
  if(!v||typeof v!=='object'||Array.isArray(v))errors.push('配置必须为映射');
  else if(id==='app.robot'){
   if(Number(v.schema_version)!==1)errors.push('schema_version 必须为 1');
   for(const key of ['name','package_version','urdf','base_link','tip_link','hardware_config','master_config'])if(typeof v[key]!=='string'||!v[key])errors.push(`${key} 必须为非空字符串`);
   if(!Number.isInteger(nativeInt(yamlDocument(textOf(file)),['ecat_id']))||nativeInt(yamlDocument(textOf(file)),['ecat_id'])<0)errors.push('ecat_id 必须为非负整数');
   if(!['ecm','igh','mujoco'].includes(v.master_type))errors.push('master_type 必须为 ecm、igh 或 mujoco');
   for(const key of Object.keys(v))if(!['schema_version','name','package_version','urdf','base_link','tip_link','ecat_id','hardware_config','master_type','master_config'].includes(key))errors.push(`未知机器人字段：${key}`);
  }
  return errors.map(message=>({code:id+'.config',severity:'error' as const,message,fileId:file.id}));
 },references:v=>refs(v,fields),
 export:(_,ctx)=>{
  const doc=yamlDocument(textOf(ctx.file));for(const r of ctx.rewrites)doc.setIn(r.field.split('.'),r.value);
  const outputs:{path:string;bytes:Uint8Array;fileId?:string}[]=[];
  if(id==='app.robot'){
   const ref=collectReferences(ctx.project).find(r=>r.sourceFileId===ctx.file.id&&r.field==='master_config');
   const master=ctx.project.files.find(f=>f.id===ref?.targetFileId);
   if(master&&['igh','ecm'].includes(master.role)&&Number(readYaml(textOf(master))?.version)!==2){
    if(doc.get('master_type')!==master.role)throw new Error('robot.master_type 与主站配置不一致');
    const path=resolvePath(ctx.path,'master.yaml')!;
    outputs.push({path,bytes:utf8.encode(stringify(appMasterConfig(ctx.project,master,path)))});
    doc.set('master_config',relativePath(ctx.path,path));
   }
  }
  return [{path:ctx.path,bytes:ctx.rewrites.length||outputs.length?utf8.encode(doc.toString()):ctx.file.bytes,fileId:ctx.file.id},...outputs];
 }
});
export const appPackageModules:ConfigModule[]=[
 module('app.robot',v=>Number(v?.schema_version)===1&&typeof v?.hardware_config==='string',['urdf','hardware_config','master_config']),
 module('app.device',v=>Number(v?.schema_version)===1&&!!v?.expected_robot,['tool_config',...['joint_zero','kinematics','dynamics','payload','tool_tcp'].map(k=>'calibration_files.'+k)]),
 module('app.user',(v,path)=>/(?:^|\/)user\.ya?ml$/i.test(path)&&v&&typeof v==='object'&&!Array.isArray(v),['software.robot_config','software.device_config','robot.urdf','robot.hardware_config','robot.master_config','device.tool_config',...['joint_zero','kinematics','dynamics','payload','tool_tcp'].map(k=>'device.calibration_files.'+k)]),
 module('app.master',v=>!!v?.master&&Number(v?.version)!==1&&(!v?.slaves||Number(v?.version)===2),['master.eni']),
 module('app.tool',v=>Number(v?.schema_version)===1&&!!v?.tcp,['model.urdf']),
];
