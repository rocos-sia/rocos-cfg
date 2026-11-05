import { stringify } from 'yaml';
import { robotConfigFile, appDocument } from '../documents/app-config';
import { relativePath } from './paths';
import { yamlDocument } from '../documents/yaml';
import { textOf, utf8 } from './types';
import { makeFile } from './create';
import { baseTarget, attachProfile } from './profiles';
import { collectReferences } from './references';
import { starterData } from './templates';
import type { Project, MasterKind, EntryPoints, TargetProfile } from './types';

export interface Configuration {
  enabled: { bus:boolean; app:boolean; simulation:boolean };
  masters: Partial<Record<MasterKind,{entry:EntryPoints['master'];target:TargetProfile}>>;
  simulationFileId?:string;
  appMaster?:MasterKind;
  disabledMasters?:MasterKind[];
}
export function configuration(p:Project):Configuration {
  const value=p.editor.configuration;
  return value ?? {enabled:{bus:true,app:true,simulation:false},masters:{},appMaster:p.entrypoints.master.kind};
}
export function configure(p:Project):Configuration {
  return p.editor.configuration ??= configuration(p);
}
export function masterKinds(p:Project):MasterKind[] {
  return (['igh','ecm'] as const).filter(k=>k===p.entrypoints.master.kind||configuration(p).masters[k]&&!configuration(p).disabledMasters?.includes(k));
}
export function masterProject(p:Project,kind:MasterKind):Project {
  if(kind===p.entrypoints.master.kind)return p;
  const saved=configuration(p).masters[kind];
  return saved?{...p,entrypoints:{...p.entrypoints,master:saved.entry},targets:{...p.targets,master:saved.target}}:p;
}
export function selectMaster(p:Project,kind:MasterKind) {
  const config=configure(p);
  config.disabledMasters=config.disabledMasters?.filter(k=>k!==kind);
  config.masters[p.entrypoints.master.kind]={entry:structuredClone(p.entrypoints.master),target:structuredClone(p.targets.master)};
  if(kind===p.entrypoints.master.kind)return;
  let selected=config.masters[kind];
  if(!selected){
    const existing=p.files.find(f=>f.role===kind);
    const file=existing??makeFile(`master/${kind}.yaml`,kind,stringify(starterData()[kind]));
    if(!existing&&p.files.some(f=>f.path===file.path))throw new Error(`路径已存在：${file.path}，请先导入已有配置`);
    if(!existing)p.files.push(file);
    const eniFileId=collectReferences(p).find(r=>r.sourceFileId===file.id&&r.field==='eni')?.targetFileId??null;
    selected={entry:{kind,fileId:file.id,eniFileId},target:baseTarget(kind)};
    config.masters[kind]=selected;
  }
  p.entrypoints.master=structuredClone(selected.entry);p.targets.master=structuredClone(selected.target);
  attachProfile(p,'master');
}
export function enableSimulation(p:Project) {
  const config=configure(p);config.enabled.simulation=true;
  if(config.simulationFileId)return;
  const robot=robotConfigFile(p),urdf=p.files.find(f=>f.id===p.entrypoints.urdf),hardware=p.files.find(f=>f.id===p.entrypoints.hardware);
  const base=(robot?.role==='app.robot'?robot:urdf)?.path.split('/').slice(0,-1).join('/')??'robots/robot';
  const path=base+'/mjcf/mujoco.yaml';
  const app=p.files.find(f=>f.id===p.entrypoints.app),ecatId=app?appDocument(app,p).data.robot?.ecat_id??0:0;
  const file=makeFile(path,'mujoco',stringify({model:'scene.xml',hardware_config:hardware?relativePath(path,hardware.path):'../hardware.yaml',ecat_id:ecatId,cycle_time_us:1000,duration_sec:-1,visualize:true}));
  if(p.files.some(f=>f.path===file.path))throw new Error('仿真配置路径已存在，请先整理工程文件');
  p.files.push(file);config.simulationFileId=file.id;
}

// Common ID and cycle are copied explicitly; vendor startup options and ENI stay independent.
export function synchronizeBus(p:Project,id:number,cycle:number) {
 for(const kind of masterKinds(p)){
  const view=masterProject(p,kind),file=p.files.find(f=>f.id===view.entrypoints.master.fileId);
  if(!file)continue;
  if(p.editor.buffers[file.id])throw new Error('请先处理主站源码草稿');
  const doc=yamlDocument(textOf(file));
  const legacy=kind==='igh'&&doc.has('master');
  doc.setIn(legacy?['master','master_id']:['id'],id);
  doc.setIn(legacy?['master','period_us']:['cycle'],cycle);
  file.bytes=utf8.encode(doc.toString());
 }
}

export function selectAppMaster(p:Project,kind:MasterKind) {
  const robot=robotConfigFile(p),master=p.files.find(f=>f.id===masterProject(p,kind).entrypoints.master.fileId);
  if(robot?.role==='app.robot'&&master){
    if(p.editor.buffers[robot.id])throw new Error('请先处理机器人配置源码草稿');
    const doc=yamlDocument(textOf(robot));doc.set('master_type',kind);doc.set('master_config',relativePath(robot.path,master.path));robot.bytes=utf8.encode(doc.toString());
    p.references=p.references.filter(r=>r.sourceFileId!==robot.id||r.field!=='master_config');
  }
  configure(p).appMaster=kind;
}
export function applicationProject(p:Project):Project {return masterProject(p,configuration(p).appMaster??p.entrypoints.master.kind);}

export function validConfiguration(value:unknown,files:Project['files'],active:Project['entrypoints']['master']):boolean {
 if(value===undefined)return true;
 if(!value||typeof value!=='object')return false;
 const c=value as Configuration;
 if(!c.enabled||!['bus','app','simulation'].every(k=>typeof c.enabled[k as keyof typeof c.enabled]==='boolean')||!c.masters||typeof c.masters!=='object')return false;
 for(const [kind,saved] of Object.entries(c.masters)){
  if(!['igh','ecm'].includes(kind)||!saved||saved.entry?.kind!==kind||!saved.target||typeof saved.target.version!=='string')return false;
  if(saved.entry.fileId!==null&&!files.some(f=>f.id===saved.entry.fileId&&f.role===kind))return false;
  if(saved.entry.eniFileId!==null&&!files.some(f=>f.id===saved.entry.eniFileId&&f.role==='eni'))return false;
 }
 if(c.disabledMasters!==undefined&&(!Array.isArray(c.disabledMasters)||c.disabledMasters.some(k=>!['igh','ecm'].includes(k)||k===active.kind)))return false;
 if(c.appMaster!==undefined&&c.appMaster!==active.kind&&!c.masters[c.appMaster])return false;
 if(c.simulationFileId!==undefined&&!files.some(f=>f.id===c.simulationFileId&&f.role==='mujoco'))return false;
 return !c.enabled.simulation||typeof c.simulationFileId==='string';
}
