import { readYaml, yamlDocument, num } from '../documents/yaml';
import { xmlDocument, elements } from '../documents/xml';
import { textOf, utf8 } from '../project/types';
import type { ConfigModule } from './contracts';
const capabilities={readonly:false,generate:false,advancedEdit:true,desktop:false};
export const simulationModules:ConfigModule[]=[{
 id:'mujoco',version:1,role:'mujoco',syntax:'yaml',capabilities,
 detect:f=>/\.ya?ml$/i.test(f.path)&&!!readYaml(textOf(f))?.model,
 parse:f=>readYaml(textOf(f)),
 validate:(v,{file})=>{
  const errors:string[]=[];
  if(!v||typeof v!=='object'||Array.isArray(v))errors.push('仿真启动配置必须为映射');
  else {
   for(const key of Object.keys(v))if(!['model','hardware_config','ecat_id','cycle_time_us','duration_sec','visualize','urdf'].includes(key))errors.push(`未知仿真字段：${key}`);
   if(v.model!==undefined&&v.urdf!==undefined)errors.push('model 与 urdf 不能同时设置');
   const model=v.model??v.urdf;if(typeof model!=='string'||!model.trim())errors.push('model 必须指定工程文件');
   if(v.hardware_config!==undefined&&(typeof v.hardware_config!=='string'||!v.hardware_config.trim()))errors.push('hardware_config 必须指定工程文件');
   if(v.ecat_id!==undefined&&(!Number.isSafeInteger(num(v.ecat_id))||num(v.ecat_id)<0))errors.push('ecat_id 必须为非负整数');
   if(v.cycle_time_us!==undefined&&(!Number.isFinite(num(v.cycle_time_us))||num(v.cycle_time_us)<1||num(v.cycle_time_us)>4294967295))errors.push('cycle_time_us 超出范围');
   if(v.duration_sec!==undefined&&(!Number.isFinite(num(v.duration_sec))||(num(v.duration_sec)!==-1&&num(v.duration_sec)<0)))errors.push('duration_sec 必须为 -1 或非负数');
   if(v.visualize!==undefined&&typeof v.visualize!=='boolean')errors.push('visualize 必须为布尔值');
  }
  return errors.map(message=>({code:'simulation.config',severity:'error' as const,message,fileId:file.id}));
 },
 references:v=>{const key=v?.model!==undefined?'model':'urdf',model=v?.[key];if(typeof model!=='string')return [];const directory=model.includes('/')?model.slice(0,model.lastIndexOf('/')+1):'';return [{field:key,original:model},{field:'hardware_config',original:v.hardware_config??directory+'hardware_config.yaml'}];},
 export:(_,ctx)=>{const doc=yamlDocument(textOf(ctx.file));for(const r of ctx.rewrites)doc.set(r.field,r.value);return [{path:ctx.path,bytes:ctx.rewrites.length?utf8.encode(doc.toString()):ctx.file.bytes,fileId:ctx.file.id}];}
},{
 id:'simulation-hardware',version:1,role:'simulation-hardware',syntax:'yaml',capabilities,
 detect:()=>false,parse:f=>readYaml(textOf(f)),
 validate:(v,{file})=>{
  const errors:string[]=[],ids=new Set<number>();
  if(!Array.isArray(v?.hardware))errors.push('hardware 必须为数组');
  else for(const device of v.hardware){
   if(!device||!['driver','ft_sensor','io'].includes(device.type)){errors.push('仿真硬件类型必须为 driver、ft_sensor 或 io');continue;}
   const id=num(device.id);if(!Number.isSafeInteger(id)||id<0||ids.has(id))errors.push('仿真硬件 ID 必须为非负且唯一的整数');ids.add(id);
   if(device.type==='driver'){
    if(typeof device.joint_name!=='string'||!device.joint_name.trim())errors.push(`设备 ${id} 必须填写 MJCF joint_name`);
    for(const key of ['ratio','cnt_per_unit','torque_per_unit'])if(device.transform?.[key]!==undefined&&(!Number.isFinite(num(device.transform[key]))||num(device.transform[key])===0))errors.push(`设备 ${id} 的 ${key} 必须为有限非零数`);
   }
   for(const group of ['inputs','outputs'])if(device[group]!==undefined){
    if(!device[group]||typeof device[group]!=='object'||Array.isArray(device[group]))errors.push(`设备 ${id} 的 ${group} 必须为映射`);
    else for(const value of Object.values(device[group]))if(typeof value!=='string')errors.push(`设备 ${id} 的 PDO 名称必须为字符串`);
   }
  }
  return errors.map(message=>({code:'simulation.hardware',severity:'error' as const,message,fileId:file.id}));
 },references:()=>[],export:(_,ctx)=>[{path:ctx.path,bytes:ctx.file.bytes,fileId:ctx.file.id}]
},{
 id:'mjcf',version:1,role:'mjcf',syntax:'xml',capabilities,
 detect:f=>/\.xml$/i.test(f.path)&&['mujoco','mujocoinclude'].includes(xmlDocument(textOf(f)).documentElement.localName),parse:f=>xmlDocument(textOf(f)),
 validate:(doc,{file})=>['mujoco','mujocoinclude'].includes(doc.documentElement.localName)?[]:[{code:'simulation.mjcf',severity:'error',message:'MJCF 根节点必须为 mujoco 或 mujocoinclude',fileId:file.id}],
 references:doc=>{
  const compiler=elements(doc,'compiler')[0];
  return ['include','mesh','texture','hfield'].flatMap(tag=>elements(doc,tag).flatMap((el,i)=>{
   const file=el.getAttribute('file');if(!file)return [];
   const dir=tag==='mesh'?compiler?.getAttribute('meshdir'):tag==='texture'?compiler?.getAttribute('texturedir'):'';
   return [{field:`${tag}[${i}].file`,original:dir?`${dir}/${file}`:file}];
  }));
 },
 export:(_,ctx)=>{if(ctx.rewrites.length)throw new Error('MJCF 资源须保持相对目录结构');return [{path:ctx.path,bytes:ctx.file.bytes,fileId:ctx.file.id}];}
}];
