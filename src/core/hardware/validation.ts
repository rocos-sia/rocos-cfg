import { m as msg, messageFields, type MessageInput, type DiagnosticMessage } from '../project/messages';
import { fileById, type BusCatalog, type Diagnostic, type Project } from '../project/types';
import type { RobotJoint } from '../documents/urdf';
import { appRules, targetStatus } from '../project/profiles';
import { axes, bindingDocument, channels, finiteNumber as number, hardwareDocument, hardwareTypes, isRecord, signals, type HardwareType, type SignalSpec } from './schema';

function signalTypeDiagnostic(dataType: string | undefined, spec: SignalSpec): DiagnosticMessage | undefined {
  if(!dataType)return undefined;
  const name=dataType.toUpperCase();
  const signed:Record<string,number>={SINT:1,INT:2,DINT:4,LINT:8,INTEGER8:1,INTEGER16:2,INTEGER32:4,INTEGER64:8,INT8:1,INT16:2,INT32:4,INT64:8};
  const unsigned:Record<string,number>={USINT:1,UINT:2,UDINT:4,ULINT:8,UNSIGNED8:1,UNSIGNED16:2,UNSIGNED32:4,UNSIGNED64:8,UINT8:1,UINT16:2,UINT32:4,UINT64:8,BYTE:1,WORD:2,DWORD:4,LWORD:8};
  if((spec.kind==='signed' && signed[name]===spec.bytes)||(spec.kind==='unsigned'&&unsigned[name]===spec.bytes)||(spec.kind==='bits'&&(signed[name]||unsigned[name])===spec.bytes))return undefined;
  return msg("{v0} 与 APP 的 {v1} {v2} bit 不匹配或尚未识别", {v0:String(dataType), v1:(spec.kind==='bits' ? msg("位掩码").text : (spec.kind==='signed' ? msg("有符号整数").text : msg("无符号整数").text)), v2:String(spec.bytes*8)});
}
export function signalTypeProblem(dataType: string | undefined, spec: SignalSpec): string | undefined { return signalTypeDiagnostic(dataType,spec)?.message; }
export function validateHardware(p:Project,bus:BusCatalog,chain?:RobotJoint[]):Diagnostic[] {
  const result:Diagnostic[]=[];const file=fileById(p,p.entrypoints.hardware),binding=fileById(p,p.entrypoints.binding);
  const add=(code:string,message:MessageInput,field?:string,severity:Diagnostic['severity']='error',fileId=file?.id)=>result.push({code:'hardware.'+code,...messageFields(message),field,severity,fileId});
  if(!file)return result;
  const target=targetStatus(p,'app');if(!target.supported){add('target',target);return result;}
  let parsed:ReturnType<typeof hardwareDocument>;
  try{parsed=hardwareDocument(file);}catch{return result;} // Syntax is reported by the module parser.
  const {data,devices}=parsed;
  if(!isRecord(data)||!Array.isArray(data.hardware))add('schema',msg("hardware 必须为设备列表"),'hardware');
  const ids=new Set<number>();
  for(const [i,d] of devices.entries()) {
    const path=`hardware.${i}`;
    if(!isRecord(d)){add('schema',msg("设备条目必须为映射"),path);continue;}
    const id=d.id;
    if(!Number.isInteger(id)||ids.has(id)||!bus.slaves.some(s=>s.id===id))add('id',msg("Hardware ID {v0} 必须为唯一、存在于主站的 int32 从站 ID", {v0:String(id)}),path+'.id');ids.add(id);
    if(!hardwareTypes.includes(d.type)){add('type',msg("APP 会忽略不支持的硬件类型 {v0}", {v0:String(String(d.type))}),path+'.type');continue;}
    const type=d.type as HardwareType;
    const allowed=['id','type',...(type==='driver'?['joint_name','torque_source','transform','limit','inputs','outputs']:type==='ft_sensor'?['inputs','offset']:['inputs','outputs',...channels])];
    const unknown=(obj:Record<string,any>,keys:string[],prefix:string)=>Object.keys(obj).filter(k=>!keys.includes(k)).forEach(k=>add('ignored',msg("{v0}.{v1} 不被当前 APP 消费，原文保留", {v0:String(prefix), v1:String(k)}),prefix+'.'+k,'warning'));
    unknown(d,allowed,path);
    const required=new Set<string>();
    for(const group of ['inputs','outputs'] as const)for(const spec of signals[type][group])if(spec.required)required.add(group+'.'+spec.key);
    if(type==='io') {
      for(const key of channels) {
        const max=key.startsWith('analog')?appRules.maxAnalogChannelsPerDirection:32;
        if(!Number.isInteger(d[key])||d[key]<0||d[key]>max)add('channels',msg("{v0} 必须为 0–{v1} 的整数{v2}", {v0:String(key), v1:String(max), v2:(max===1 ? msg("；当前 APP 各模拟通道访问同一个 int16 值").text : "")}),path+'.'+key);
      }
      if(d.digital_in_channels>0)required.add('inputs.digital_inputs');
      if(d.digital_out_channels>0){required.add('inputs.digital_outputs');required.add('outputs.digital_outputs');}
      if(d.analog_in_channels>0)required.add('inputs.analog_inputs');
      if(d.analog_out_channels>0)required.add('outputs.analog_outputs');
    }
    for(const group of ['inputs','outputs'] as const) {
      const mapping=d[group];
      if(mapping!==undefined&&!isRecord(mapping)){add('schema',msg("{v0} 必须为映射", {v0:String(group)}),path+'.'+group);continue;}
      const specs=signals[type][group];
      if(isRecord(mapping))unknown(mapping,specs.map(s=>s.key),path+'.'+group);
      const assigned=new Map<string,string>();
      for(const spec of specs) {
        const value=mapping?.[spec.key],field=path+'.'+group+'.'+spec.key;
        if(value===undefined||value==='') {
          if(required.has(group+'.'+spec.key))add('required',msg("{v0} 尚未映射{v1}", {v0:String(spec.key), v1:(type==='driver' ? msg("，默认位置控制需要此信号").text : "")}),field);
          continue;
        }
        if(typeof value!=='string'){add('signal',msg("{v0} 必须为非空 PDO 变量名", {v0:String(spec.key)}),field);continue;}
        if(assigned.has(value))add('shared-signal',msg("{v0} 与 {v1} 共用变量 {v2}", {v0:String(spec.key), v1:String(assigned.get(value)), v2:String(value)}),field,group==='outputs'?'error':'warning');assigned.set(value,spec.key);
        const matches=bus.signals.filter(s=>s.slaveId===id&&s.direction===(group==='inputs'?'input':'output')&&s.runtimeName===value&&s.resolution==='resolved');
        if(matches.length!==1){add('signal',msg("设备 {v0} {v1}.{v2} 无法唯一映射：{v3}", {v0:String(id), v1:String(group), v2:String(spec.key), v3:String(value)}),field);continue;}
        const s=matches[0];
        if(s.storageBytes!==spec.bytes||s.bitLength!==spec.bytes*8)add('width',msg("{v0} 需要完整 {v1} bit / {v2} 字节，当前为 {v3} bit / {v4} 字节", {v0:String(spec.key), v1:String(spec.bytes*8), v2:String(spec.bytes), v3:String(s.bitLength), v4:String(s.storageBytes)}),field);
        const problem=signalTypeDiagnostic(s.dataType,spec);
        if(problem)add('datatype',problem,field);
        else if(!s.dataType)add('datatype-unverified',msg("{v0} 的源配置未声明数据类型；请依据设备手册确认符号及整数类型", {v0:String(spec.key)}),field,'warning');
      }
    }
    if(type==='driver') {
      const t=isRecord(d.transform)?d.transform:{},l=isRecord(d.limit)?d.limit:{};
      if(!isRecord(d.transform))add('schema',msg("transform 必须为映射并明确填写机械换算"),path+'.transform');
      if(!isRecord(d.limit))add('schema',msg("limit 必须为映射并明确填写限位"),path+'.limit');
      unknown(t,['ratio','offset_pos_cnt','cnt_per_unit','torque_per_unit','user_unit_name'],path+'.transform');
      unknown(l,['lower','upper','vel','acc','jerk','effort'],path+'.limit');
      for(const k of ['ratio','cnt_per_unit','torque_per_unit'])if(!Number.isFinite(number(t[k]))||number(t[k])===0)add('transform',msg("{v0} 须明确填写有限非零数", {v0:String(k)}),path+'.transform.'+k);
      if(!Number.isInteger(t.offset_pos_cnt))add('offset',msg("offset_pos_cnt 须为 int32 整数"),path+'.transform.offset_pos_cnt');
      if(t.user_unit_name!==undefined&&(typeof t.user_unit_name!=='string'||!t.user_unit_name))add('unit',msg("user_unit_name 须为非空字符串"),path+'.transform.user_unit_name');
      for(const k of ['lower','upper','vel','acc','jerk','effort'])if(!Number.isFinite(number(l[k]))||(!['lower','upper'].includes(k)&&number(l[k])<=0))add('limit',msg("{v0} 须明确填写有限{v1}", {v0:String(k), v1:(['lower','upper'].includes(k) ? msg("数").text : msg("正数").text)}),path+'.limit.'+k);
      if(number(l.lower)>number(l.upper))add('limit-order',msg("位置下限不能大于上限"),path+'.limit');
      const scale=number(t.ratio)*number(t.cnt_per_unit),offset=t.offset_pos_cnt;
      for(const k of ['lower','upper']){
        const raw=number(l[k])*scale;
        if(Number.isFinite(raw)&&Number.isInteger(offset)&&(raw < -2147483648||raw>2147483647||Math.trunc(raw)+offset < -2147483648||Math.trunc(raw)+offset>2147483647))add('overflow',msg("{v0} 换算超出 int32，包含转换前值及叠加零点后值", {v0:String(k)}),path+'.limit.'+k);
      }
      if(Number.isFinite(scale)&&Number.isFinite(number(l.vel))&&Math.abs(scale*number(l.vel))>2147483647)add('overflow',msg("速度限值换算超出双向 int32 范围"),path+'.limit.vel');
      if(Number.isFinite(number(l.effort))&&Number.isFinite(number(t.torque_per_unit))&&Math.abs(number(l.effort)*number(t.torque_per_unit))>32767)add('overflow',msg("力矩限值换算超出双向 int16 范围"),path+'.limit.effort');
      if(d.torque_source!==undefined&&!['load_torque','secondary_position'].includes(d.torque_source))add('torque-source',msg("torque_source 仅支持 load_torque / secondary_position；其他值会被 APP 当作 load_torque"),path+'.torque_source');
      const source=d.torque_source==='secondary_position'?'secondary_position_value':'load_torque_value';
      if(!d.inputs?.[source])add('torque-input',msg("{v0} 未映射，APP 的负载力矩读取将返回 0", {v0:String(source)}),path+'.inputs.'+source,'warning');
      if(offset!==0&&Number.isInteger(offset))add('offset-runtime',msg("当前 APP 在 int32 中先减零点再转 double；原始反馈极值可能溢出。速度反馈也会减去位置零点，请核对消费端行为"),path+'.transform.offset_pos_cnt','warning');
      if(!p.editor.confirmations[`drive:${id}`])add('confirmation',msg("设备 {v0} 的换算与限位需要人工确认", {v0:String(id)}),path);
    } else if(type==='ft_sensor') {
      if(d.offset!==undefined&&!isRecord(d.offset))add('schema',msg("offset 必须为映射"),path+'.offset');
      if(isRecord(d.offset))unknown(d.offset,axes,path+'.offset');
      for(const k of axes)if(d.offset?.[k]!==undefined&&!Number.isFinite(number(d.offset[k])))add('offset',msg("{v0} 偏置须为有限数", {v0:String(k)}),path+'.offset.'+k);
    }
  }
  if(devices.filter(d=>d?.type==='ft_sensor').length>1)add('ft-first',msg("当前 APP 的 GetWrench 只读取列表中的第一个 FT 传感器"),'hardware','warning');
  if(!binding)return result;
  let b:ReturnType<typeof bindingDocument>;
  try{b=bindingDocument(binding);}catch{return result;}
  const bindError=(code:string,message:MessageInput,field?:string,severity:Diagnostic['severity']='error')=>result.push({code:'binding.'+code,...messageFields(message),field,severity,fileId:binding.id});
  if(!isRecord(b.data)||!Array.isArray(b.data.joint_bindings))bindError('schema',msg("joint_bindings 必须为列表"),'joint_bindings');
  if(b.data?.binding_policy!==undefined&&b.data.binding_policy!=='explicit')bindError('policy',msg("当前 APP 仅支持 explicit 绑定策略"),'binding_policy');
  const names=new Set<string>(),used=new Set<number>();
  for(const [i,entry] of b.bindings.entries()){
    const field=`joint_bindings.${i}`;
    if(!isRecord(entry)){bindError('schema',msg("绑定条目必须为映射"),field);continue;}
    const id=entry.drive_id;
    if(typeof entry.joint_name!=='string'||!entry.joint_name||names.has(entry.joint_name))bindError('name',msg("关节名称为空、无效或重复"),field+'.joint_name');names.add(entry.joint_name);
    if(!Number.isInteger(id)||used.has(id)||!devices.some(d=>d?.type==='driver'&&d.id===id))bindError('invalid',msg("{v0} 必须绑定唯一有效的 driver ID", {v0:String(entry.joint_name)}),field+'.drive_id');used.add(id);
    if(chain&&!chain.some(j=>j.name===entry.joint_name))bindError('extra',msg("{v0} 不在当前控制链", {v0:String(entry.joint_name)}),field+'.joint_name');
    const j=chain?.find(j=>j.name===entry.joint_name),d=devices.find(d=>d?.type==='driver'&&d.id===id);
    if(j&&d){
      const unit=d.transform?.user_unit_name??'rad',expected=j.type==='prismatic'?'m':'rad';
      if(unit!==expected)bindError('unit',msg("{v0} 的 URDF 单位为 {v1}，Hardware 为 {v2}；APP 不会自动转换", {v0:String(j.name), v1:String(expected), v2:String(String(unit))}),field);
      if(d.joint_name&&d.joint_name!==j.name)bindError('label',msg("Drive {v0} 的显示名称 {v1} 与绑定关节 {v2} 不同；实际按显式绑定工作", {v0:String(id), v1:String(String(d.joint_name)), v2:String(j.name)}),field,'warning');
      for(const [a,k] of [['lower','lower'],['upper','upper'],['velocity','vel'],['effort','effort']] as const){
        const effective=j[a]!==''?Number(j[a]):undefined;
        if(effective!==undefined&&number(d.limit?.[k])!==effective)bindError('limit-difference',msg("{v0} 的标准 URDF {v1}={v2} 与 Hardware {v3}={v4} 不同；请核对模型约束与硬件配置", {v0:String(j.name), v1:String(a), v2:String(effective), v3:String(k), v4:String(String(d.limit?.[k]))}),field,'warning');
      }
    }
  }
  if(chain)for(const j of chain)if(!names.has(j.name))bindError('missing',msg("{v0} 缺少显式绑定", {v0:String(j.name)}),'joint_bindings');
  return result;
}
