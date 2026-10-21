import { fileById, type BusCatalog, type Diagnostic, type Project } from '../project/types';
import type { RobotJoint } from '../documents/urdf';
import { appRules, targetStatus } from '../project/profiles';
import { axes, bindingDocument, channels, finiteNumber as number, hardwareDocument, hardwareTypes, isRecord, signals, type HardwareType, type SignalSpec } from './schema';

export function signalTypeProblem(dataType: string | undefined, spec: SignalSpec): string | undefined {
  if(!dataType)return undefined;
  const name=dataType.toUpperCase();
  const signed:Record<string,number>={SINT:1,INT:2,DINT:4,LINT:8,INTEGER8:1,INTEGER16:2,INTEGER32:4,INTEGER64:8,INT8:1,INT16:2,INT32:4,INT64:8};
  const unsigned:Record<string,number>={USINT:1,UINT:2,UDINT:4,ULINT:8,UNSIGNED8:1,UNSIGNED16:2,UNSIGNED32:4,UNSIGNED64:8,UINT8:1,UINT16:2,UINT32:4,UINT64:8,BYTE:1,WORD:2,DWORD:4,LWORD:8};
  if((spec.kind==='signed' && signed[name]===spec.bytes)||(spec.kind==='unsigned'&&unsigned[name]===spec.bytes)||(spec.kind==='bits'&&(signed[name]||unsigned[name])===spec.bytes))return undefined;
  return `${dataType} 与 APP 的 ${spec.kind==='bits'?'位掩码':spec.kind==='signed'?'有符号整数':'无符号整数'} ${spec.bytes*8} bit 不匹配或尚未识别`;
}
export function validateHardware(p:Project,bus:BusCatalog,chain?:RobotJoint[]):Diagnostic[] {
  const result:Diagnostic[]=[];const file=fileById(p,p.entrypoints.hardware),binding=fileById(p,p.entrypoints.binding);
  const add=(code:string,message:string,field?:string,severity:Diagnostic['severity']='error',fileId=file?.id)=>result.push({code:'hardware.'+code,message,field,severity,fileId});
  if(!file)return result;
  const target=targetStatus(p,'app');if(!target.supported){add('target',target.message);return result;}
  let parsed:ReturnType<typeof hardwareDocument>;
  try{parsed=hardwareDocument(file);}catch{return result;} // Syntax is reported by the module parser.
  const {data,devices}=parsed;
  if(!isRecord(data)||!Array.isArray(data.hardware))add('schema','hardware 必须为设备列表','hardware');
  const ids=new Set<number>();
  for(const [i,d] of devices.entries()) {
    const path=`hardware.${i}`;
    if(!isRecord(d)){add('schema','设备条目必须为映射',path);continue;}
    const id=d.id;
    if(!Number.isInteger(id)||ids.has(id)||!bus.slaves.some(s=>s.id===id))add('id',`Hardware ID ${id} 必须为唯一、存在于主站的 int32 从站 ID`,path+'.id');ids.add(id);
    if(!hardwareTypes.includes(d.type)){add('type',`APP 会忽略不支持的硬件类型 ${String(d.type)}`,path+'.type');continue;}
    const type=d.type as HardwareType;
    const allowed=['id','type',...(type==='driver'?['joint_name','torque_source','transform','limit','inputs','outputs']:type==='ft_sensor'?['inputs','offset']:['inputs','outputs',...channels])];
    const unknown=(obj:Record<string,any>,keys:string[],prefix:string)=>Object.keys(obj).filter(k=>!keys.includes(k)).forEach(k=>add('ignored',`${prefix}.${k} 不被当前 APP 消费，原文保留`,prefix+'.'+k,'warning'));
    unknown(d,allowed,path);
    const required=new Set<string>();
    for(const group of ['inputs','outputs'] as const)for(const spec of signals[type][group])if(spec.required)required.add(group+'.'+spec.key);
    if(type==='io') {
      for(const key of channels) {
        const max=key.startsWith('analog')?appRules.maxAnalogChannelsPerDirection:32;
        if(!Number.isInteger(d[key])||d[key]<0||d[key]>max)add('channels',`${key} 必须为 0–${max} 的整数${max===1?'；当前 APP 各模拟通道访问同一个 int16 值':''}`,path+'.'+key);
      }
      if(d.digital_in_channels>0)required.add('inputs.digital_inputs');
      if(d.digital_out_channels>0){required.add('inputs.digital_outputs');required.add('outputs.digital_outputs');}
      if(d.analog_in_channels>0)required.add('inputs.analog_inputs');
      if(d.analog_out_channels>0)required.add('outputs.analog_outputs');
    }
    for(const group of ['inputs','outputs'] as const) {
      const mapping=d[group];
      if(mapping!==undefined&&!isRecord(mapping)){add('schema',`${group} 必须为映射`,path+'.'+group);continue;}
      const specs=signals[type][group];
      if(isRecord(mapping))unknown(mapping,specs.map(s=>s.key),path+'.'+group);
      const assigned=new Map<string,string>();
      for(const spec of specs) {
        const value=mapping?.[spec.key],field=path+'.'+group+'.'+spec.key;
        if(value===undefined||value==='') {
          if(required.has(group+'.'+spec.key))add('required',`${spec.key} 尚未映射${type==='driver'?'，默认位置控制需要此信号':''}`,field);
          continue;
        }
        if(typeof value!=='string'){add('signal',`${spec.key} 必须为非空 PDO 变量名`,field);continue;}
        if(assigned.has(value))add('shared-signal',`${spec.key} 与 ${assigned.get(value)} 共用变量 ${value}`,field,group==='outputs'?'error':'warning');assigned.set(value,spec.key);
        const matches=bus.signals.filter(s=>s.slaveId===id&&s.direction===(group==='inputs'?'input':'output')&&s.runtimeName===value&&s.resolution==='resolved');
        if(matches.length!==1){add('signal',`设备 ${id} ${group}.${spec.key} 无法唯一映射：${value}`,field);continue;}
        const s=matches[0];
        if(s.storageBytes!==spec.bytes||s.bitLength!==spec.bytes*8)add('width',`${spec.key} 需要完整 ${spec.bytes*8} bit / ${spec.bytes} 字节，当前为 ${s.bitLength} bit / ${s.storageBytes} 字节`,field);
        const problem=signalTypeProblem(s.dataType,spec);
        if(problem)add('datatype',problem,field);
        else if(!s.dataType)add('datatype-unverified',`${spec.key} 的源配置未声明数据类型；请依据设备手册确认符号及整数类型`,field,'warning');
      }
    }
    if(type==='driver') {
      const t=isRecord(d.transform)?d.transform:{},l=isRecord(d.limit)?d.limit:{};
      if(!isRecord(d.transform))add('schema','transform 必须为映射并明确填写机械换算',path+'.transform');
      if(!isRecord(d.limit))add('schema','limit 必须为映射并明确填写限位',path+'.limit');
      unknown(t,['ratio','offset_pos_cnt','cnt_per_unit','torque_per_unit','user_unit_name'],path+'.transform');
      unknown(l,['lower','upper','vel','acc','jerk','effort'],path+'.limit');
      for(const k of ['ratio','cnt_per_unit','torque_per_unit'])if(!Number.isFinite(number(t[k]))||number(t[k])===0)add('transform',`${k} 须明确填写有限非零数`,path+'.transform.'+k);
      if(!Number.isInteger(t.offset_pos_cnt))add('offset','offset_pos_cnt 须为 int32 整数',path+'.transform.offset_pos_cnt');
      if(t.user_unit_name!==undefined&&(typeof t.user_unit_name!=='string'||!t.user_unit_name))add('unit','user_unit_name 须为非空字符串',path+'.transform.user_unit_name');
      for(const k of ['lower','upper','vel','acc','jerk','effort'])if(!Number.isFinite(number(l[k]))||(!['lower','upper'].includes(k)&&number(l[k])<=0))add('limit',`${k} 须明确填写有限${['lower','upper'].includes(k)?'数':'正数'}`,path+'.limit.'+k);
      if(number(l.lower)>number(l.upper))add('limit-order','位置下限不能大于上限',path+'.limit');
      const scale=number(t.ratio)*number(t.cnt_per_unit),offset=t.offset_pos_cnt;
      for(const k of ['lower','upper']){
        const raw=number(l[k])*scale;
        if(Number.isFinite(raw)&&Number.isInteger(offset)&&(raw < -2147483648||raw>2147483647||Math.trunc(raw)+offset < -2147483648||Math.trunc(raw)+offset>2147483647))add('overflow',`${k} 换算超出 int32，包含转换前值及叠加零点后值`,path+'.limit.'+k);
      }
      if(Number.isFinite(scale)&&Number.isFinite(number(l.vel))&&Math.abs(scale*number(l.vel))>2147483647)add('overflow','速度限值换算超出双向 int32 范围',path+'.limit.vel');
      if(Number.isFinite(number(l.effort))&&Number.isFinite(number(t.torque_per_unit))&&Math.abs(number(l.effort)*number(t.torque_per_unit))>32767)add('overflow','力矩限值换算超出双向 int16 范围',path+'.limit.effort');
      if(d.torque_source!==undefined&&!['load_torque','secondary_position'].includes(d.torque_source))add('torque-source','torque_source 仅支持 load_torque / secondary_position；其他值会被 APP 当作 load_torque',path+'.torque_source');
      const source=d.torque_source==='secondary_position'?'secondary_position_value':'load_torque_value';
      if(!d.inputs?.[source])add('torque-input',`${source} 未映射，APP 的负载力矩读取将返回 0`,path+'.inputs.'+source,'warning');
      if(offset!==0&&Number.isInteger(offset))add('offset-runtime','当前 APP 在 int32 中先减零点再转 double；原始反馈极值可能溢出。速度反馈也会减去位置零点，请核对消费端行为',path+'.transform.offset_pos_cnt','warning');
      if(!p.editor.confirmations[`drive:${id}`])add('confirmation',`设备 ${id} 的换算与限位需要人工确认`,path);
    } else if(type==='ft_sensor') {
      if(d.offset!==undefined&&!isRecord(d.offset))add('schema','offset 必须为映射',path+'.offset');
      if(isRecord(d.offset))unknown(d.offset,axes,path+'.offset');
      for(const k of axes)if(d.offset?.[k]!==undefined&&!Number.isFinite(number(d.offset[k])))add('offset',`${k} 偏置须为有限数`,path+'.offset.'+k);
    }
  }
  if(devices.filter(d=>d?.type==='ft_sensor').length>1)add('ft-first','当前 APP 的 GetWrench 只读取列表中的第一个 FT 传感器','hardware','warning');
  if(!binding)return result;
  let b:ReturnType<typeof bindingDocument>;
  try{b=bindingDocument(binding);}catch{return result;}
  const bindError=(code:string,message:string,field?:string,severity:Diagnostic['severity']='error')=>result.push({code:'binding.'+code,message,field,severity,fileId:binding.id});
  if(!isRecord(b.data)||!Array.isArray(b.data.joint_bindings))bindError('schema','joint_bindings 必须为列表','joint_bindings');
  if(b.data?.binding_policy!==undefined&&b.data.binding_policy!=='explicit')bindError('policy','当前 APP 仅支持 explicit 绑定策略','binding_policy');
  const names=new Set<string>(),used=new Set<number>();
  for(const [i,entry] of b.bindings.entries()){
    const field=`joint_bindings.${i}`;
    if(!isRecord(entry)){bindError('schema','绑定条目必须为映射',field);continue;}
    const id=entry.drive_id;
    if(typeof entry.joint_name!=='string'||!entry.joint_name||names.has(entry.joint_name))bindError('name','关节名称为空、无效或重复',field+'.joint_name');names.add(entry.joint_name);
    if(!Number.isInteger(id)||used.has(id)||!devices.some(d=>d?.type==='driver'&&d.id===id))bindError('invalid',`${entry.joint_name} 必须绑定唯一有效的 driver ID`,field+'.drive_id');used.add(id);
    if(chain&&!chain.some(j=>j.name===entry.joint_name))bindError('extra',`${entry.joint_name} 不在当前控制链`,field+'.joint_name');
    const j=chain?.find(j=>j.name===entry.joint_name),d=devices.find(d=>d?.type==='driver'&&d.id===id);
    if(j&&d){
      const unit=d.transform?.user_unit_name??'rad',expected=j.type==='prismatic'?'m':'rad';
      if(unit!==expected)bindError('unit',`${j.name} 的 URDF 单位为 ${expected}，Hardware 为 ${String(unit)}；APP 不会自动转换`,field);
      if(d.joint_name&&d.joint_name!==j.name)bindError('label',`Drive ${id} 的显示名称 ${String(d.joint_name)} 与绑定关节 ${j.name} 不同；实际按显式绑定工作`,field,'warning');
      for(const [a,k] of [['lower','lower'],['upper','upper'],['velocity','vel'],['effort','effort']] as const){
        const effective=j[a]!==''?Number(j[a]):undefined;
        if(effective!==undefined&&number(d.limit?.[k])!==effective)bindError('limit-difference',`${j.name} 的标准 URDF ${a}=${effective} 与 Hardware ${k}=${String(d.limit?.[k])} 不同；请核对模型约束与硬件配置`,field,'warning');
      }
    }
  }
  if(chain)for(const j of chain)if(!names.has(j.name))bindError('missing',`${j.name} 缺少显式绑定`,'joint_bindings');
  return result;
}
