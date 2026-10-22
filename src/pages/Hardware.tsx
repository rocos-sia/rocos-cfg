import { DiagnosticField, useDiagnosticRequest } from '../components/DiagnosticNavigation';
import { useLocalizedMessage } from '../components/useLocalizedMessage';
import { m as msg, MessageError } from '../core/project/messages';
import { errorText, diagnosticText, t } from '../i18n';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Modal, Select, Space, Table, Tabs, Tag } from 'antd';
import { type Project, fileById } from '../core/project/types';
import type { ProjectAnalysis } from '../core/project/analysis';
import { axes, bindingDocument, channels, hardwareDocument, hardwareTypes, isRecord, signals, type HardwareType } from '../core/hardware/schema';
import { bindJoint, legacyBindingSuggestion, planHardware, planLegacyBinding } from '../core/hardware/edit';
import { validateHardware } from '../core/hardware/validation';
import { useProject } from '../store';
import { Fields, type FieldSpec } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';

export function Hardware({p,analysis}:{p:Project;analysis?:ProjectAnalysis}) {
  const file=fileById(p,p.entrypoints.hardware),binding=fileById(p,p.entrypoints.binding);
  const message=useLocalizedMessage();const [selected,setSelected]=useState(0);
  const [addType,setAddType]=useState<HardwareType>(),[slave,setSlave]=useState<number>(),[joint,setJoint]=useState<string>();
  const [pending,setPending]=useState<{project:Project;impactMessages:import('../core/project/messages').DiagnosticMessage[];revision:number;epoch:number;selected:number}>();
  const diagnostic=useDiagnosticRequest();
  useEffect(()=>{if(diagnostic?.mode==='field'&&diagnostic.fileId===file?.id&&diagnostic.index!==undefined)setSelected(diagnostic.index);},[diagnostic]);
  if(!analysis)return null;
  if(!file)return <Alert type="warning" message={t("请先导入或创建 Hardware 文件，再配置设备。")}/>;
  let devices:Record<string,any>[]=[],binds:Record<string,any>[]=[],parseError='';
  try{const hw=hardwareDocument(file);if(!Array.isArray(hw.data?.hardware)||hw.devices.some(d=>!isRecord(d)))throw new MessageError(msg("hardware 必须为设备映射列表"));devices=hw.devices;}catch(e){parseError=errorText(e,true);}
  try{if(binding)binds=bindingDocument(binding).bindings.filter(isRecord);}catch(e){parseError+=errorText(e,true);}
  const bus=analysis.catalog,d=devices[selected],chain=analysis.chain,chainError=analysis.chainError?diagnosticText({message:analysis.chainError,text:analysis.chainErrorText}):'';
  let legacy:ReturnType<typeof legacyBindingSuggestion>=[],legacyError='';
  if(!binding)try{legacy=legacyBindingSuggestion(p);}catch(e){legacyError=errorText(e,true);}
  const diagnostics=validateHardware(p,bus,chainError?undefined:chain);
  const run=(fn:()=>void)=>{try{fn();}catch(e){message.error(()=>(errorText(e,true)));}};
  const stage=(action:Parameters<typeof planHardware>[1],selection=selected)=>run(()=>{const plan=planHardware(p,action);setPending({...plan,revision:p.revision,epoch:useProject.getState().workspaceEpoch,selected:selection});setAddType(undefined);});
  const update=(path:(string|number)[],value:unknown)=>run(()=>useProject.getState().yaml(file.id,path,value));
  const freeSlaves=bus.slaves.filter(s=>!devices.some(d=>d.id===s.id));
  const field=(key:string,label:string,type:FieldSpec['type']='number',extra:Partial<FieldSpec>={}):FieldSpec=>({path:`hardware.${selected}.${key}`,label,type,...extra});
  const deviceDiagnostics=diagnostics.filter(x=>x.field===`hardware.${selected}`||x.field?.startsWith(`hardware.${selected}.`));
  return <>
    <div className="page-heading"><div><h1>{t("硬件与绑定")}</h1><p>{t("按控制关节选择实际从站，确认机械换算与过程数据。")}</p></div><Space wrap>{hardwareTypes.map(type=><Button key={type} disabled={!freeSlaves.length||!!parseError} onClick={()=>{setAddType(type);setSlave(undefined);setJoint(undefined);}}>{t('新增 {type}',{type})}</Button>)}</Space></div>
    {parseError&&<Alert type="error" message={t("配置结构无效，请修复源文件")} description={parseError}/>}
    {!freeSlaves.length&&<Alert type="info" message={t("没有未使用的从站；可在主站配置中添加从站或调整现有设备。")}/>}
    <div className="hardware-layout"><Card title={t("硬件设备")}><Table className="hardware-device-table" size="small" pagination={false} rowKey={(_,i)=>String(i)} dataSource={devices}
      rowSelection={{type:'radio',columnWidth:84,columnTitle:t('选择'),selectedRowKeys:d?[String(selected)]:[],onChange:keys=>setSelected(Number(keys[0])),
        getCheckboxProps:device=>({name:`hardware-device-${file.id}`,'aria-label':t('选择设备 {id}（{type}）',{id:String(device.id),type:String(device.type)})})}}
      onRow={(_,i)=>({onClick:()=>setSelected(i!)})} columns={[{title:'ID',dataIndex:'id',render:v=>String(v)},{title:t("类型"),dataIndex:'type'},{title:t("关节"),dataIndex:'joint_name',render:v=>typeof v==='string'?v:''}]}/></Card>
      <Card title={d?t('设备 {id} · {type}',{id:d.id,type:String(d.type)}):t("选择或新增硬件")} extra={d&&<Button danger onClick={()=>stage({kind:'delete',index:selected},Math.max(0,selected-1))}>{t("删除设备")}</Button>}>
        {d&&<>
          <DiagnosticField className="field" fileId={file.id} field={`hardware.${selected}.id`}><label htmlFor="hardware-slave">{t("Hardware / 从站 ID")}</label><Select id="hardware-slave" value={d.id} options={bus.slaves.filter(s=>s.id===d.id||!devices.some(v=>v.id===s.id)).map(s=>({value:s.id,label:`Slave ${s.id} · ${s.name}`}))} onChange={id=>stage({kind:'id',index:selected,id})}/></DiagnosticField>
          {d.type==='driver'&&<>
            <Fields file={file} fields={[field('joint_name',t("关节显示名称"),'text'),field('torque_source',t("负载力矩来源"),'select',{options:['load_torque','secondary_position'],defaultValue:'load_torque'}),field('transform.user_unit_name',t("物理单位"),'text',{defaultValue:'rad',help:t("旋转关节 rad，直线关节 m；APP 不会根据单位名称自动换算。")}),...['ratio','offset_pos_cnt','cnt_per_unit','torque_per_unit'].map(k=>field('transform.'+k,k))]}/>
            <p>{t("位置 = (原始计数 − offset_pos_cnt) / cnt_per_unit / ratio；力矩 = 原始值 / torque_per_unit。")}</p>
            <Fields file={file} fields={['lower','upper','vel','acc','jerk','effort'].map(k=>field('limit.'+k,k))}/>
            <Alert type="info" message={t("标准 URDF 与 Hardware 限位分别保留；请核对模型约束和硬件配置。")}/>
            <DiagnosticField fileId={file.id} field={`hardware.${selected}`}><Checkbox checked={!!p.editor.confirmations[`drive:${d.id}`]} onChange={e=>useProject.getState().change(n=>{n.editor.confirmations[`drive:${d.id}`]=e.target.checked;})}>{t("已人工核对换算、零点与限位")}</Checkbox></DiagnosticField>
          </>}
          {d.type==='ft_sensor'&&<><Alert type="info" message={t("六路 int16 输入；APP 读取原始值并加上各轴偏置，没有独立缩放系数。")}/><Fields file={file} fields={axes.map(k=>field('offset.'+k,t('{axis} 偏置',{axis:k}),'number',{defaultValue:0}))}/></>}
          {d.type==='io'&&<><Alert type="info" message={t("数字量按 32 bit 位掩码访问；数字输出需要输入反馈。当前 APP 的模拟量仅支持一个独立 int16 值。")}/><Fields file={file} fields={channels.map(k=>field(k,k,'number',{min:0,max:k.startsWith('analog')?1:32,defaultValue:0}))}/></>}
          {hardwareTypes.includes(d.type)&&<div className="signal-fields">{(['inputs','outputs'] as const).filter(g=>signals[d.type as HardwareType][g].length).map(group=><div key={group}><h3>{group==='inputs'?t("输入 · TxPDO"):t("输出 · RxPDO")}</h3>{signals[d.type as HardwareType][group].map(spec=><DiagnosticField className="field" key={spec.key} fileId={file.id} field={`hardware.${selected}.${group}.${spec.key}`}><label htmlFor={`signal-${group}-${spec.key}`}>{spec.key}{spec.required?' *':''} · {spec.bytes*8} bit</label><Select id={`signal-${group}-${spec.key}`} allowClear showSearch optionFilterProp="label" value={typeof d[group]?.[spec.key]==='string'?d[group][spec.key]:undefined} options={bus.signals.filter(s=>s.slaveId===d.id&&s.direction===(group==='inputs'?'input':'output')).map(s=>({label:`${s.runtimeName} · ${s.bitLength} bit / ${s.storageBytes} B · ${s.dataType||t("类型待核对")}${s.resolution==='resolved'?'':t(" · 无法唯一定位")}`,value:s.runtimeName,disabled:s.resolution!=='resolved'}))} onChange={v=>update(['hardware',selected,group,spec.key],v??'')}/></DiagnosticField>)}</div>)}</div>}
          {deviceDiagnostics.length>0&&<div className="space-top"><Alert type={deviceDiagnostics.some(x=>x.severity==='error')?'error':'warning'} message={t("设备检查")} description={<ul>{deviceDiagnostics.map((x,i)=><li key={i}>{diagnosticText(x)}</li>)}</ul>}/></div>}
        </>}
      </Card>
    </div>
    <Card className="space-top" title={t("显式关节绑定")} extra={<Tag>{t("模型顺序与总线顺序独立")}</Tag>}>
      {!binding&&<Alert type="warning" message={t("缺少显式绑定文件")} description={legacyError||t("APP 将按模型关节顺序对应 Hardware YAML 中 Driver 的顺序；下表仅为推导建议。")} action={<Button disabled={!legacy.length} onClick={()=>run(()=>setPending({...planLegacyBinding(p),revision:p.revision,epoch:useProject.getState().workspaceEpoch,selected}))}>{t("预览并生成显式绑定")}</Button>}/>}
      {chainError&&<Alert type="error" message={chainError}/>}
      <Table scroll={{x:600}} pagination={false} rowKey="name" dataSource={chain} columns={[{title:t("链序号"),render:(_,__,i)=>i+1},{title:'URDF Joint',dataIndex:'name'},{title:'Hardware Drive ID / Slave',render:(_,j)=><Select aria-label={t('{joint} 驱动器绑定',{joint:j.name})} disabled={!binding} allowClear placeholder={t("选择驱动器")} style={{minWidth:210}} value={(binding?binds:legacy).find(b=>b.joint_name===j.name)?.drive_id} options={devices.filter(d=>d.type==='driver').map(d=>({value:d.id,label:`Drive ${d.id} → Slave ${d.id}`,disabled:binds.some(b=>b.drive_id===d.id&&b.joint_name!==j.name)}))} onChange={id=>run(()=>useProject.getState().change(n=>bindJoint(n,j.name,id)))}/>}]} />
      {diagnostics.filter(d=>binding&&d.fileId===binding.id).map((x,i)=><p key={i}><Tag color={x.severity==='error'?'red':'orange'}>{x.severity==='error'?t("错误"):t("待核对")}</Tag>{diagnosticText(x)}</p>)}
    </Card>
    <Card className="space-top"><Tabs items={[{key:'hw',label:t("Hardware 源文件"),children:<SourceEditor file={file}/>},{key:'binding',label:t("Binding 源文件"),children:binding?<SourceEditor file={binding}/>:<p>{t("尚未生成显式绑定文件。")}</p>}]} /></Card>
    <Modal title={t('新增 {type}',{type:addType||''})} open={!!addType} onCancel={()=>setAddType(undefined)} okText={t("预览配置草稿")} okButtonProps={{disabled:slave===undefined}} onOk={()=>{if(addType&&slave!==undefined)stage({kind:'add',type:addType,id:slave,joint},devices.length);}}>
      <div className="field"><label htmlFor="new-hardware-slave">{t("目标从站")}</label><Select id="new-hardware-slave" value={slave} options={freeSlaves.map(s=>({value:s.id,label:`Slave ${s.id} · ${s.name}`}))} onChange={setSlave}/></div>
      {addType==='driver'&&<div className="field"><label htmlFor="new-hardware-joint">{t("控制关节（可稍后绑定）")}</label><Select id="new-hardware-joint" disabled={!binding} allowClear value={joint} options={chain.filter(j=>!binds.some(b=>b.joint_name===j.name)).map(j=>({value:j.name,label:j.name}))} onChange={setJoint}/><p>{t("选择关节可带入 URDF 限位。只生成唯一匹配的 PDO 候选，不猜测机械比例或零点。")}</p></div>}
    </Modal>
    <Modal title={t("确认硬件变更")} open={!!pending} onCancel={()=>setPending(undefined)} okText={t("应用变更")} onOk={()=>run(()=>{if(!pending)return;const current=useProject.getState().project;if(useProject.getState().workspaceEpoch!==pending.epoch||current?.id!==pending.project.id||current.revision!==pending.revision)throw new MessageError(msg("工程已变化，请重新预览"));useProject.getState().change(n=>Object.assign(n,pending.project));setSelected(pending.selected);setPending(undefined);})}>
      <ul>{pending?.impactMessages.map((x,i)=><li key={i}>{diagnosticText(x)}</li>)}</ul><p>{t("本次修改会清除机械参数确认；整次操作支持撤销。")}</p>
    </Modal>
  </>;
}
