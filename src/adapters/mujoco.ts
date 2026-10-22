import type { Diagnostic, Project, ProjectFile } from '../core/project/types';
import { fileById, textOf } from '../core/project/types';
import { configuration } from '../core/project/configuration';
import { readYaml } from '../core/documents/yaml';
import { resolvePath, safePath } from '../core/project/paths';

export async function compileMjcf(files:ProjectFile[],path:string) {
 const url=new URL(import.meta.env.DEV?'/vendor/mujoco/mujoco_wasm.js':'../vendor/mujoco/mujoco_wasm.js',import.meta.url).href;
 const factory=(await import(/* @vite-ignore */ url)).default;
 const mj=await factory({locateFile:(name:string)=>new URL(name,url).href});
 for(const file of files){safePath(file.path);const parts=file.path.split('/');let dir='/';for(const part of parts.slice(0,-1)){dir+=part+'/';try{mj.FS.mkdir(dir);}catch{/* Shared directory. */}}mj.FS.writeFile('/'+file.path,file.bytes);}
 const model=mj.MjModel.mj_loadXML('/'+safePath(path));if(!model)throw new Error('MuJoCo 无法编译模型');
 return {mj,model};
}
export async function validateSimulation(p:Project):Promise<Diagnostic[]> {
 if(!configuration(p).enabled.simulation)return [];
 const file=fileById(p,configuration(p).simulationFileId);if(!file)return [{code:'simulation.missing',severity:'error',message:'缺少仿真启动配置'}];
 let model:any;
 try{
  const config=readYaml(textOf(file)),path=resolvePath(file.path,config.model??config.urdf);
  if(!path)throw new Error('仿真模型路径无效');
  const compiled=await compileMjcf(p.files,path);model=compiled.model;
  const hardware=p.files.find(f=>f.path===resolvePath(file.path,config.hardware_config??`${(config.model??config.urdf).split('/').slice(0,-1).join('/')}/hardware_config.yaml`));
  const issues:Diagnostic[]=[];
  for(const d of hardware?readYaml(textOf(hardware)).hardware:[]){
   if(d.type!=='driver')continue;
   const id=compiled.mj.mj_name2id(model,compiled.mj.mjtObj.mjOBJ_JOINT.value,d.joint_name);
   if(id<0||![2,3].includes(model.jnt_type[id]))issues.push({code:'simulation.joint',severity:'error',message:`仿真驱动关节 ${d.joint_name} 不存在或不是 hinge/slide`,fileId:hardware!.id});
  }
  return issues;
 }catch(e){return [{code:'simulation.compile',severity:'error',message:`MuJoCo 编译失败：${String(e)}`,fileId:file.id}];}
 finally{model?.delete();}
}
