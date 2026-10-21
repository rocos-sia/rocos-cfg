import { t } from '../i18n';
import { IghEditor } from '../components/IghEditor';
import { planSlaveChange } from '../core/bus/igh-edit';
import { download } from '../adapters/files';
import { Alert, Button, Card, Space, Table, Tabs, Tag, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { type Project, fileById } from '../core/project/types';
import type { ProjectAnalysis } from '../core/project/analysis';
import { useProject } from '../store';
import { Fields, type FieldSpec } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
import { targetStatus } from '../core/project/profiles';
import { starterData } from '../core/project/templates';
import { useState } from 'react';
const ighDefaults:Record<string,unknown>=starterData().igh.master;
const igh:FieldSpec[]=[{path:'master.master_id',label:'主站 ID',type:'number',min:0},{path:'master.period_us',label:'通信周期',type:'number',unit:'μs',min:1000},{path:'master.cpu',label:'CPU 亲和性',type:'number',min:0,help:'空值沿用当前亲和性'},{path:'master.dc',label:'分布式时钟',type:'select',options:['off','on']},{path:'master.preop_timeout_ms',label:'PREOP 超时',type:'number',unit:'ms',min:1},{path:'master.op_timeout_ms',label:'OP 超时',type:'number',unit:'ms',min:1},{path:'master.pdo_config_attempts',label:'PDO 配置尝试次数',type:'number',min:1}];
const ecm:FieldSpec[]=[{path:'id',label:'主站 ID',type:'number',min:0},{path:'eni',label:'ENI 相对路径'},{path:'cycle',label:'通信周期',type:'number',unit:'μs',min:1},{path:'duration',label:'运行时长（0 为持续）',type:'number',unit:'ms',min:0},{path:'cpuidx',label:'CPU 索引',type:'number',min:0,max:31},{path:'link',label:'链路驱动',type:'number',min:0,max:2},{path:'instance',label:'网卡实例',type:'number',min:1},{path:'mode',label:'模式（0 中断 / 1 轮询）',type:'number',min:0,max:1},{path:'dcmmode',label:'DCM 模式',type:'number',min:0,max:5},{path:'state',label:'目标状态',type:'select',options:['init','preop','safeop','op']},{path:'ctloff',label:'关闭 DCM 控制环',type:'boolean'},{path:'perf',label:'性能统计',type:'number',min:0,max:2},{path:'verbose',label:'日志等级',type:'number',min:0},{path:'log',label:'日志前缀'},{path:'maxbusslaves',label:'SDK 预分配容量',type:'number',min:1},{path:'sp',label:'RAS 端口（空为禁用）',type:'number',min:1,max:65535},{path:'mbxsrv',label:'Mailbox 端口（空为禁用）',type:'number',min:1,max:65535},{path:'flash',label:'输出闪烁（空为禁用）',type:'number',min:0,max:65535}];
export function Master({p,analysis,onImport}:{p:Project;analysis?:ProjectAnalysis;onImport:()=>void}) {
  const file=fileById(p,p.entrypoints.master.fileId),eni=fileById(p,p.entrypoints.master.eniFileId);const {message}=App.useApp();
  const [tab,setTab]=useState('slaves');
  if(!analysis)return null;
  const catalog=analysis.catalog;
  if(!file)return <Alert type="warning" message={t("请导入主站配置")}/>;
  const status=targetStatus(p,'master');
  if(!status.supported)return <><h1>{t("主站配置")}</h1><Alert type="error" message={status.message} description={t("可查看和保留原文；请在工程总览核对目标规则。")}/><SourceEditor file={file}/>{eni&&<SourceEditor file={eni}/>}</>;
  const addSlave=()=>{try{useProject.getState().change(next=>Object.assign(next,planSlaveChange(next,{kind:'add'}).project));}catch(e){message.error(String(e));}};
  return <><div className="page-heading"><div><h1>{t("主站配置")}</h1><p>{t("先定义总线，再关联机器人硬件。")}</p></div><Space><Tag color="blue">{p.entrypoints.master.kind==='igh'?'IgH EtherCAT':'Acontis EC-Master'}</Tag><Button onClick={onImport}>{t("导入配置 / ENI")}</Button>{p.entrypoints.master.kind==='igh'&&<Button onClick={()=>{if(p.editor.buffers[file.id]){message.error(t("请先应用源码草稿"));return;}if(catalog.diagnostics.some(d=>d.severity==='error')){message.error(t("请先修复主站配置错误"));return;}download(file.bytes,'igh.yaml');message.success(t("已生成主站文件下载；空 PDO 条目仍需在目标设备运行时发现"));}}>{t("导出 IgH 主站文件")}</Button>}</Space></div>
    <Card title={t("启动参数")} extra={<Tag>{t("目标")}{p.targets.master.version}</Tag>}><Fields file={file} fields={p.entrypoints.master.kind==='igh'?igh.map(field=>({...field,defaultValue:ighDefaults[field.path.split('.')[1]]})):ecm}/></Card>
    <Card title={t("总线配置视图")} className="space-top" extra={p.entrypoints.master.kind==='igh'?<Button icon={<PlusOutlined aria-hidden />} onClick={addSlave}>{t("新增从站")}</Button>:<Tag color="gold">{t("来自 ENI · 只读")}</Tag>}>
      <Tabs activeKey={tab} onChange={setTab} items={[
        {key:'slaves',label:t('从站 ({count})',{count:catalog.slaves.length}),children:<Table size="small" rowKey="id" dataSource={catalog.slaves} pagination={false} columns={[{title:t("运行时 ID"),dataIndex:'id'},{title:t("名称"),dataIndex:'name'},{title:t("固定地址"),dataIndex:'address',render:v=>v??'—'},{title:'Vendor',dataIndex:'vendor',render:v=>v||'—'},{title:'Product',dataIndex:'product',render:v=>v||'—'}]}/>},
        {key:'signals',label:t('过程映像 ({count})',{count:catalog.signals.length}),children:<Table size="small" scroll={{x:900}} rowKey="uid" dataSource={catalog.signals} columns={[{title:t("从站"),dataIndex:'slaveId',width:80},{title:t("方向"),dataIndex:'direction',width:100,render:v=><Tag color={v==='input'?'blue':'purple'}>{v==='input'?t("输入 Tx"):t("输出 Rx")}</Tag>},{title:t("运行时名称"),dataIndex:'runtimeName'},{title:t("位宽"),dataIndex:'bitLength',width:70},{title:t("位偏移"),dataIndex:'bitOffset',width:80,render:v=>v??'—'},{title:t("原始名称"),dataIndex:'sourceName'},{title:t("解析"),dataIndex:'resolution',width:100}]}/>},
        ...(p.entrypoints.master.kind==='igh'?[{key:'edit',label:t("PDO / SDO 编辑"),children:<IghEditor p={p}/>}]:[]),
        {key:'source',label:t("源文件"),children:<SourceEditor file={file}/>},
        ...(eni?[{key:'eni',label:t("ENI 原文 · 只读"),children:<SourceEditor file={eni}/>}]:[])
      ]}/>
      {catalog.diagnostics.map((d,i)=><Alert className="space-top" key={i} type={d.severity==='error'?'error':'warning'} showIcon message={d.message}/>)}
    </Card>
  </>;
}
