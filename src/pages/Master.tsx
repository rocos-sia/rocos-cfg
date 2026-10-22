import { useDiagnosticRequest } from '../components/DiagnosticNavigation';
import { useLocalizedMessage } from '../components/useLocalizedMessage';
import { errorText, diagnosticText, t } from '../i18n';
import { IghEditor } from '../components/IghEditor';
import { planSlaveChange } from '../core/bus/igh-edit';
import { download } from '../adapters/files';
import { Alert, Button, Card, Space, Table, Tabs, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { type Project, fileById } from '../core/project/types';
import type { ProjectAnalysis } from '../core/project/analysis';
import { useProject } from '../store';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
import { targetStatus } from '../core/project/profiles';
import { starterData } from '../core/project/templates';
import { useEffect, useState } from 'react';
import { igh, ecm } from '../core/documents/config-fields';
const ighDefaults:Record<string,unknown>=starterData().igh.master;
export function Master({p,analysis,onImport}:{p:Project;analysis?:ProjectAnalysis;onImport:()=>void}) {
  const file=fileById(p,p.entrypoints.master.fileId),eni=fileById(p,p.entrypoints.master.eniFileId);const message=useLocalizedMessage();
  const [tab,setTab]=useState('slaves');
  const diagnostic=useDiagnosticRequest();
  useEffect(()=>{if(diagnostic&&diagnostic.fileId===file?.id&&diagnostic.mode==='field'&&diagnostic.index!==undefined)setTab('edit');},[diagnostic]);
  if(!analysis)return null;
  const catalog=analysis.catalog;
  if(!file)return <Alert type="warning" message={t("请导入主站配置")}/>;
  const status=targetStatus(p,'master');
  if(!status.supported)return <><h1>{t("主站配置")}</h1><Alert type="error" message={diagnosticText(status)} description={t("可查看和保留原文；请在工程总览核对目标规则。")}/><SourceEditor file={file}/>{eni&&<SourceEditor file={eni}/>}</>;
  const addSlave=()=>{try{useProject.getState().change(next=>Object.assign(next,planSlaveChange(next,{kind:'add'}).project));}catch(e){message.error(()=>(errorText(e,true)));}};
  return <><div className="page-heading"><div><h1>{t("主站配置")}</h1><p>{t("先定义总线，再关联机器人硬件。")}</p></div><Space wrap><Tag color="blue">{p.entrypoints.master.kind==='igh'?'IgH EtherCAT':'Acontis EC-Master'}</Tag><Button onClick={onImport}>{t("导入配置 / ENI")}</Button>{p.entrypoints.master.kind==='igh'&&<Button onClick={()=>{if(p.editor.buffers[file.id]){message.error(()=>(t("请先应用源码草稿")));return;}if(catalog.diagnostics.some(d=>d.severity==='error')){message.error(()=>(t("请先修复主站配置错误")));return;}download(file.bytes,'igh.yaml');message.success(()=>(t("已生成主站文件下载；空 PDO 条目仍需在目标设备运行时发现")));}}>{t("导出 IgH 主站文件")}</Button>}</Space></div>
    <Card title={t("启动参数")} extra={<Tag>{t("目标")}{p.targets.master.version}</Tag>}><Fields file={file} fields={p.entrypoints.master.kind==='igh'?igh.map(field=>({...field,defaultValue:ighDefaults[field.path.split('.')[1]]})):ecm}/></Card>
    <Card title={t("总线配置视图")} className="space-top" extra={p.entrypoints.master.kind==='igh'?<Button icon={<PlusOutlined aria-hidden />} onClick={addSlave}>{t("新增从站")}</Button>:<Tag color="gold">{t("来自 ENI · 只读")}</Tag>}>
      <Tabs activeKey={tab} onChange={setTab} items={[
        {key:'slaves',label:t('从站 ({count})',{count:catalog.slaves.length}),children:<Table size="small" scroll={{x:650}} rowKey="id" dataSource={catalog.slaves} pagination={false} columns={[{title:t("运行时 ID"),dataIndex:'id'},{title:t("名称"),dataIndex:'name'},{title:t("固定地址"),dataIndex:'address',render:v=>v??'—'},{title:'Vendor',dataIndex:'vendor',render:v=>v||'—'},{title:'Product',dataIndex:'product',render:v=>v||'—'}]}/>},
        {key:'signals',label:t('过程映像 ({count})',{count:catalog.signals.length}),children:<Table size="small" scroll={{x:900}} rowKey="uid" dataSource={catalog.signals} columns={[{title:t("从站"),dataIndex:'slaveId',width:80},{title:t("方向"),dataIndex:'direction',width:100,render:v=><Tag color={v==='input'?'blue':'purple'}>{v==='input'?t("输入 Tx"):t("输出 Rx")}</Tag>},{title:t("运行时名称"),dataIndex:'runtimeName'},{title:t("位宽"),dataIndex:'bitLength',width:70},{title:t("位偏移"),dataIndex:'bitOffset',width:80,render:v=>v??'—'},{title:t("原始名称"),dataIndex:'sourceName'},{title:t("解析"),dataIndex:'resolution',width:100}]}/>},
        ...(p.entrypoints.master.kind==='igh'?[{key:'edit',label:t("PDO / SDO 编辑"),children:<IghEditor p={p}/>}]:[]),
        {key:'source',label:t("源文件"),children:<SourceEditor file={file}/>},
        ...(eni?[{key:'eni',label:t("ENI 原文 · 只读"),children:<SourceEditor file={eni}/>}]:[])
      ]}/>
      {catalog.diagnostics.map((d,i)=><Alert className="space-top" key={i} type={d.severity==='error'?'error':'warning'} showIcon message={diagnosticText(d)}/>)}
    </Card>
  </>;
}
