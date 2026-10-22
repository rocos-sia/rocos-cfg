// Local acceptance inputs only. Never copy upstream assets/configuration into the application bundle.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProject } from '../../src/core/project/create';
import { inspectImport, applyImport, defaultImportSelection } from '../../src/core/project/import';
import { hardwareDocument, signals } from '../../src/core/hardware/schema';
import { buildBusCatalog } from '../../src/core/bus/catalog';
import { fileById, type MasterKind } from '../../src/core/project/types';
import { verifySourceBaseline } from '../consumer/source';
export const realSourcesAvailable = !!(process.env.ROCOS_APP_SOURCE && process.env.ROCOS_IGH_SOURCE && process.env.ROCOS_ECM_SOURCE);
export async function realProjectInputs(kind: MasterKind) {
  const app=process.env.ROCOS_APP_SOURCE!, master=kind==='igh'?process.env.ROCOS_IGH_SOURCE!:process.env.ROCOS_ECM_SOURCE!;
  const masterProof=verifySourceBaseline(master,kind==='igh'?'3c92f2a':'d85a6f3',kind==='igh'?['src/pdo_config.cpp','src/pdo_config.hpp']:['Main/Common/EcConfig.cpp','Main/Common/EcConfig.h']);
  const sourceProof={master:masterProof,app:verifySourceBaseline(app,'7093bcd',['src/app_config.hpp','src/hardware.cpp','src/joint_binding.cpp','src/model.cpp'])};
  const entries=new Map<string,Uint8Array>();
  const put=async(path:string,local:string)=>entries.set(path,new Uint8Array(await readFile(local)));
  const walk=async(local:string,path:string)=>{for(const entry of await readdir(local,{withFileTypes:true})){if(entry.isDirectory())await walk(resolve(local,entry.name),path+'/'+entry.name);else if(entry.isFile())await put(path+'/'+entry.name,resolve(local,entry.name));else throw Error('Acceptance inputs must contain regular files/directories');}};
  for(const name of ['config.yaml','hardware_talon_config.yaml','joint_binding.yaml','payload.yaml'])await put('config/'+name,resolve(app,'config',name));
  await walk(resolve(app,'config/scripts'),'config/scripts');await walk(resolve(app,'web'),'web');
  await put('models/talon/robot.urdf',resolve(app,'models/talon/robot.urdf'));
  for(const name of await readdir(resolve(app,'models/talon')))if(/\.stl$/i.test(name))await put('models/talon/meshes/'+name,resolve(app,'models/talon',name));
  await put('master/'+kind+'.yaml',resolve(master,kind==='igh'?'config/talon_pdo.yaml':'config/config.yaml'));
  if(kind==='ecm')await put('master/eni7.xml',resolve(master,'config/eni7.xml'));
  const base=createProject('Talon acceptance '+kind,kind),plan=inspectImport(base,entries),project=applyImport(base,plan,defaultImportSelection(plan));
  const bus=buildBusCatalog(project),devices=hardwareDocument(fileById(project,project.entrypoints.hardware)!).devices;
  if(bus.slaves.length!==7||devices.length!==7)throw Error('Review the seven-axis acceptance baseline before changing inputs');
  const corrections:{id:number;group:'inputs'|'outputs';key:string;from:string;to:string;reason:'case'|'unavailable'}[]=[];
  for(const device of devices)for(const group of ['inputs','outputs'] as const)for(const spec of signals.driver[group]) {
    const value=device[group]?.[spec.key];if(typeof value!=='string'||!value)continue;
    const candidates=bus.signals.filter(signal=>signal.slaveId===device.id&&signal.direction===(group==='inputs'?'input':'output')&&signal.resolution==='resolved'&&signal.runtimeName.toLowerCase()===value.toLowerCase()&&signal.storageBytes===spec.bytes&&signal.bitLength===spec.bytes*8);
    if(candidates.some(signal=>signal.runtimeName===value))continue;
    if(candidates.length===1)corrections.push({id:device.id,group,key:spec.key,from:value,to:candidates[0].runtimeName,reason:'case'});
    else if(kind==='igh'&&group==='inputs'&&['load_torque_value','secondary_position_value'].includes(spec.key)&&candidates.length===0)
      corrections.push({id:device.id,group,key:spec.key,from:value,to:'',reason:'unavailable'});
    else throw Error(`Review ambiguous/missing acceptance mapping ${device.id}/${group}/${spec.key}`);
  }
  return {entries,corrections,sourceProof};
}
