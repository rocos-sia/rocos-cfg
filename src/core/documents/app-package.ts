import { stringify } from 'yaml';
import { makeFile } from '../project/create';
import { fileById, textOf, utf8, type Project, type ProjectFile } from '../project/types';
import { relativePath, resolvePath } from '../project/paths';
import { readYaml, yamlDocument } from './yaml';
import { xmlDocument } from './xml';
import { appDocument } from './app-config';
import { bindingDocument, hardwareDocument } from '../hardware/schema';
import { baseTarget, attachProfile } from '../project/profiles';
import { collectReferences } from '../project/references';
import { ecmDocument } from '../bus/ecm';
import { readIghEni } from '../bus/igh-eni';

/** New packages use hardware joint_name; legacy archives remain readable as authored. */
export function createAppPackage(p:Project) {
  const app=fileById(p,p.entrypoints.app)!,urdf=fileById(p,p.entrypoints.urdf)!,hardware=fileById(p,p.entrypoints.hardware)!;
  const data=appDocument(app).data,base='robots/'+robotPackageName(urdf),robotPath=base+'/robot.yaml';
  p.references=collectReferences(p);
  const modelBase=urdf.path.split('/').slice(0,-1).join('/');
  if(modelBase&&modelBase!==base){
    for(const file of p.files)if(file.id!==urdf.id&&file.path.startsWith(modelBase+'/'))file.path=base+file.path.slice(modelBase.length);
    for(const [name,path] of Object.entries(p.packageMap))if(path===modelBase||path.startsWith(modelBase+'/'))p.packageMap[name]=base+path.slice(modelBase.length);
  }
  urdf.path=base+'/robot.urdf';hardware.path=base+'/hardware.yaml';
  const binding=fileById(p,p.entrypoints.binding);
  if(binding){
    const doc=yamlDocument(textOf(hardware)),devices=hardwareDocument(hardware).devices;
    for(const b of bindingDocument(binding).bindings){const i=devices.findIndex(d=>d.type==='driver'&&d.id===b.drive_id);if(i>=0)doc.setIn(['hardware',i,'joint_name'],b.joint_name);}
    hardware.bytes=utf8.encode(doc.toString());p.files=p.files.filter(f=>f.id!==binding.id);p.entrypoints.binding=null;
  }
  const robot=makeFile(robotPath,'app.robot',stringify({schema_version:1,name:robotPackageName(urdf),package_version:'1.0.0',
    urdf:'robot.urdf',base_link:data.robot.base_link,tip_link:data.robot.tip_link,ecat_id:data.robot.ecat_id,
    hardware_config:'hardware.yaml',master_type:p.entrypoints.master.kind,
    master_config:relativePath(robotPath,fileById(p,p.entrypoints.master.fileId)!.path)}));
  const device=makeFile('devices/robot_001/device.yaml','app.device',stringify({schema_version:1,id:'robot_001',
    expected_robot:{name:robotPackageName(urdf),package_version:'1.0.0'},tool_config:null,tool_install:null,
    calibration_files:{joint_zero:null,kinematics:null,dynamics:null,payload:null,tool_tcp:null}}));
  const user=makeFile('app/user.yaml','app.user','{}\n');
  delete data.robot;
  app.bytes=utf8.encode(stringify({schema_version:1,robot_config:relativePath(app.path,robot.path),device_config:relativePath(app.path,device.path),user_config:relativePath(app.path,user.path),...data}));
  p.files.push(robot,device,user);p.references=collectReferences(p);
  p.targets.app=baseTarget('app');attachProfile(p,'app');
}
function robotPackageName(file:ProjectFile) {
  // XML robot names are descriptive; package names must be safe frame names.
  const name=xmlDocument(textOf(file)).documentElement.getAttribute('name')??'';
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name)&&!['.','..'].includes(name)?name:'robot';
}

/** Adapt standalone master input to App's wrapped, named-parameter contract. */
export function appMasterConfig(p:Project,file:ProjectFile,path:string) {
  if(file.role==='ecm'){
    const {data}=ecmDocument(file),master={...data};
    delete master.auxclk;delete master.flash;
    for(const [key,values] of Object.entries({verbose:['silent','errors','warnings','diagnostic','info','verbose','cyclic'],perf:['off','timing','histogram'],dcmmode:['off','bus_shift','master_shift','link_layer_ref_clock','master_ref_clock','dcx'],mode:['interrupt','polling']}))master[key]=values[master[key]];
    const ref=collectReferences(p).find(r=>r.sourceFileId===file.id&&r.field==='eni');
    const eni=fileById(p,ref?.targetFileId);if(eni)master.eni=relativePath(path,eni.path);
    return {master};
  }
  const data=readYaml(textOf(file));
  const eniRef=collectReferences(p).find(r=>r.sourceFileId===file.id&&r.field==='eni');
  const eni=fileById(p,eniRef?.targetFileId);
  const legacy=data.eni&&eni?readIghEni(eni.bytes):data;
  const m=data.eni?data:legacy.master;
  const master={id:m.id??m.master_id??0,cycle:m.cycle??m.period_us??1000,cpuidx:m.cpuidx??m.cpu??null,dc:m.dc??legacy.master?.dc??'off',
    preop_timeout_ms:m.preop_timeout_ms??10000,state_timeout_ms:m.state_timeout_ms??m.op_timeout_ms??60000,pdo_config_attempts:m.pdo_config_attempts??5,state:'op'};
  const slaves=legacy.slaves?.map((s:any)=>({id:s.id,name:s.name,dc_ref:s.dc_ref??false,init_commands:s.init_commands??[],
    rx_pdos:s.rx_pdos.map((pdo:any)=>({index:pdo.index,entries:pdo.entries.map(({name,index,sub_index,bit_length}:any)=>({name,index,sub_index,bit_length}))})),
    tx_pdos:s.tx_pdos.map((pdo:any)=>({index:pdo.index,entries:pdo.entries.map(({name,index,sub_index,bit_length}:any)=>({name,index,sub_index,bit_length}))}))}));
  return {version:2,master,slaves:slaves??[]};
}
