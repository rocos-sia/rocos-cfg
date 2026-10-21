import { makeFile } from '../project/create';
import { targetStatus } from '../project/profiles';
import { checkPaths, relativePath } from '../project/paths';
import { isMap } from 'yaml';
import { buildBusCatalog } from '../bus/catalog';
import { editProjectYaml, sequence } from '../bus/igh-edit';
import { controlChain } from '../documents/urdf';
import { appDocument } from '../documents/app-config';
import { fileById, textOf, type Project } from '../project/types';
import { bindingDocument, hardwareDocument, isRecord, signals, type HardwareType } from './schema';
import { signalTypeProblem } from './validation';

export function hardwareChain(p:Project) {
  const app=fileById(p,p.entrypoints.app),urdf=fileById(p,p.entrypoints.urdf);
  if(!app||!urdf)throw new Error('请先配置 APP 与 URDF');
  const robot=appDocument(app).data?.robot;
  return controlChain(textOf(urdf),robot?.base_link,robot?.tip_link);
}
export function bindJoint(p:Project,name:string,id:number|undefined) {
  const file=fileById(p,p.entrypoints.binding);if(!file)throw new Error('缺少绑定文件');
  const {bindings}=bindingDocument(file);
  if(bindings.some(b=>!isRecord(b)))throw new Error('请先修复无效绑定条目');
  const matches=bindings.map((b,i)=>b.joint_name===name?i:-1).filter(i=>i>=0);
  if(matches.length>1)throw new Error('关节绑定重复，请先在源码中修复');
  editProjectYaml(p,file.id,doc=>{
    const seq=sequence(doc,['joint_bindings'],true);
    doc.set('binding_policy','explicit');
    if(id===undefined){if(matches.length)seq.items.splice(matches[0],1);return;}
    if(matches.length)doc.setIn(['joint_bindings',matches[0],'drive_id'],id);
    else seq.add(doc.createNode({joint_name:name,drive_id:id}));
  });
}
export function planHardware(p:Project,action:{kind:'add';type:HardwareType;id:number;joint?:string}|{kind:'delete'|'id';index:number;id?:number}) {
  const target=targetStatus(p,'app');if(!target.supported)throw new Error(target.message);
  const next=structuredClone(p),file=fileById(next,next.entrypoints.hardware);
  if(!file)throw new Error('缺少 Hardware 文件');
  const {devices}=hardwareDocument(file),bus=buildBusCatalog(next),impacts:string[]=[];
  if(devices.some(d=>!isRecord(d)||!Number.isInteger(d.id)))throw new Error('请先修复无效硬件条目或 ID');
  if(action.kind==='add'||action.kind==='id') {
    if(!bus.slaves.some(s=>s.id===action.id))throw new Error('请选择实际存在的主站从站');
    if(devices.some((d,i)=>d.id===action.id&&(action.kind==='add'||i!==action.index)))throw new Error('该从站已被 Hardware 使用');
  }
  if(action.kind==='add') {
    const joint=action.joint?hardwareChain(next).find(j=>j.name===action.joint):undefined;
    if(action.joint&&!joint)throw new Error('关节已不在控制链');
    if(joint){const bf=fileById(next,next.entrypoints.binding);if(bf&&bindingDocument(bf).bindings.some(b=>b?.joint_name===joint.name))throw new Error('该关节已有绑定');}
    const d:Record<string,any>={id:action.id,type:action.type,inputs:{}};
    if(action.type!=='ft_sensor')d.outputs={};
    if(action.type==='driver') {
      const n=(s?:string)=>s!==undefined&&s!==''&&Number.isFinite(Number(s))?Number(s):null;
      Object.assign(d,{joint_name:joint?.name??'',torque_source:'load_torque',transform:{ratio:null,offset_pos_cnt:null,cnt_per_unit:null,torque_per_unit:null,user_unit_name:joint?.type==='prismatic'?'m':'rad'},limit:{lower:n(joint?.lower),upper:n(joint?.upper),vel:n(joint?.velocity),effort:n(joint?.effort),acc:null,jerk:null}});
      for(const group of ['inputs','outputs'] as const)for(const spec of signals.driver[group]) {
        const candidates=bus.signals.filter(s=>s.slaveId===action.id&&s.direction===(group==='inputs'?'input':'output')&&s.resolution==='resolved'&&s.storageBytes===spec.bytes&&s.bitLength===spec.bytes*8&&!signalTypeProblem(s.dataType,spec)&&(spec.index!==undefined&&s.index===spec.index&&s.subIndex===0||s.runtimeName===spec.key));
        if(candidates.length===1){d[group][spec.key]=candidates[0].runtimeName;impacts.push(`${group}.${spec.key} → ${candidates[0].runtimeName}（候选，需复核）`);}
      }
      impacts.push('换算比例、零点、力矩系数、acc / jerk 保持未配置；需要人工核对后才能导出运行包。');
    } else if(action.type==='ft_sensor')d.offset=Object.fromEntries(['fx','fy','fz','tx','ty','tz'].map(k=>[k,0]));
    else Object.assign(d,{digital_in_channels:0,digital_out_channels:0,analog_in_channels:0,analog_out_channels:0});
    editProjectYaml(next,file.id,doc=>sequence(doc,['hardware'],true).add(doc.createNode(d)));
    if(joint){bindJoint(next,joint.name,action.id);impacts.unshift(`${joint.name} → Drive ${action.id} → Slave ${action.id}；带入标准 URDF 已提供的限位，缺省值留空待核对。`);}
    impacts.unshift(`新增 ${action.type}，使用 Slave ${action.id}。`);
  } else {
    const old=devices[action.index];if(!old)throw new Error('设备已不存在');
    editProjectYaml(next,file.id,doc=>{const list=sequence(doc,['hardware']);if(action.kind==='delete')list.items.splice(action.index,1);else doc.setIn(['hardware',action.index,'id'],action.id);});
    const bf=fileById(next,next.entrypoints.binding);
    if(bf){const {bindings}=bindingDocument(bf);editProjectYaml(next,bf.id,doc=>{
      const list=sequence(doc,['joint_bindings']);
      for(let i=bindings.length-1;i>=0;i--){const b=bindings[i];if(!isRecord(b)||!isMap(list.items[i]))throw new Error('请先修复无效绑定条目');if(b.drive_id!==old.id)continue;
        impacts.push(`${b.joint_name}：${action.kind==='delete'?'移除绑定':`Drive ${old.id} → ${action.id}`}`);
        if(action.kind==='delete')list.items.splice(i,1);else doc.setIn(['joint_bindings',i,'drive_id'],action.id);
      }
    });}
    impacts.unshift(action.kind==='delete'?`删除设备 ${old.id} 及关联绑定。`:`设备 ${old.id} → ${action.id}；PDO 名称保留，需核对新从站中的变量。`);
  }
  for(const key of Object.keys(next.editor.confirmations))if(key.startsWith('drive:'))delete next.editor.confirmations[key];
  return {project:next,impacts};
}

// An approval belongs to the exact mechanical/bus configuration that was reviewed.
// Keep payload, UI metadata, names of projects, HTTP settings etc. independent.
export function invalidateHardwareConfirmation(before:Project,after:Project) {
  const key=(p:Project)=>JSON.stringify({master:p.entrypoints.master,hardware:p.entrypoints.hardware,binding:p.entrypoints.binding,urdf:p.entrypoints.urdf,targets:p.targets});
  const relevant=(p:Project)=>[p.entrypoints.hardware,p.entrypoints.binding,p.entrypoints.urdf,p.entrypoints.master.fileId,p.entrypoints.master.eniFileId];
  const bytesChanged=(id:string|null)=>{const a=fileById(before,id),b=fileById(after,id);return !a||!b?a!==b:a.encoding!==b.encoding||a.bytes.length!==b.bytes.length||a.bytes.some((v,i)=>v!==b.bytes[i]);};
  const robot=(p:Project)=>{try{const f=fileById(p,p.entrypoints.app),r=f&&appDocument(f).data?.robot;return ['ecat_id','base_link','tip_link','urdf','hardware_config','joint_binding'].map(k=>String(r?.[k])).join('\u0000');}catch{return 'invalid';}};
  if(key(before)!==key(after)||relevant(before).some(bytesChanged)||before.entrypoints.app!==after.entrypoints.app||robot(before)!==robot(after))
    for(const k of Object.keys(after.editor.confirmations))if(k.startsWith('drive:'))delete after.editor.confirmations[k];
}

export function legacyBindingSuggestion(p:Project) {
  if(fileById(p,p.entrypoints.binding))throw new Error('已存在显式绑定文件，不使用缺失文件回退规则');
  const hw=fileById(p,p.entrypoints.hardware);if(!hw)throw new Error('缺少 Hardware 文件');
  const chain=hardwareChain(p),drives=hardwareDocument(hw).devices.filter(d=>d?.type==='driver');
  if(!chain.length||chain.length!==drives.length)throw new Error('缺少绑定文件时，APP 要求控制关节数与 Driver 数量相同');
  if(drives.some(d=>!Number.isInteger(d.id))||new Set(drives.map(d=>d.id)).size!==drives.length)throw new Error('Driver ID 无效或重复，无法推导绑定');
  // Robot::jointBinding uses YAML drive order, not sorted IDs or joint_name.
  return chain.map((j,i)=>({joint_name:j.name,drive_id:drives[i].id as number}));
}
export function planLegacyBinding(p:Project) {
  const suggested=legacyBindingSuggestion(p),next=structuredClone(p),app=fileById(next,next.entrypoints.app)!;
  const base=app.path.split('/').slice(0,-1).join('/');
  let path='';
  for(let i=0;i<=next.files.length;i++){
    const candidate=(base?base+'/':'')+`joint_binding${i?'-'+i:''}.yaml`;
    try{checkPaths([...next.files.map(f=>f.path),candidate]);path=candidate;break;}catch{/* Choose a non-conflicting filename. */}
  }
  if(!path)throw new Error('无法找到无冲突的绑定文件路径');
  const file=makeFile(path,'binding','binding_policy: explicit\njoint_bindings: []\n');next.files.push(file);next.entrypoints.binding=file.id;
  for(const b of suggested)bindJoint(next,b.joint_name,b.drive_id);
  editProjectYaml(next,app.id,doc=>doc.setIn(['robot','joint_binding'],relativePath(app.path,path)));
  next.references=next.references.filter(r=>r.sourceFileId!==app.id||r.field!=='robot.joint_binding');
  for(const k of Object.keys(next.editor.confirmations))if(k.startsWith('drive:'))delete next.editor.confirmations[k];
  return {project:next,impacts:[`新增显式绑定文件 ${path}，同步 APP 引用。`,...suggested.map(b=>`${b.joint_name} → Drive ${b.drive_id}（来源：Hardware YAML 中 Driver 的顺序）`)]};
}
