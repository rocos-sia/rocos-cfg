import { exportMaster } from '../core/export';
import { EniImport } from '../components/EniImport';
import { ConfigurationImportMenu } from '../components/ConfigurationImportMenu';
import { synchronizeBus, selectAppMaster, masterKinds, selectMaster, configure, configuration } from '../core/project/configuration';
import { PdoTemplateSelect, pdoTemplateDescription } from '../components/PdoTemplateSelect';
import type { DevicePreset } from '../core/project/templates';
import { ProcessImage } from '../components/ProcessImage';
import { SlaveTable } from '../components/SlaveTable';
import { useDiagnosticRequest } from '../components/DiagnosticNavigation';
import { useLocalizedMessage } from '../components/useLocalizedMessage';
import { errorText, diagnosticText, t } from '../i18n';
import { IghEditor } from '../components/IghEditor';
import { planSlaveChange } from '../core/bus/igh-edit';
import { download } from '../adapters/files';
import { Alert, Button, Card, Space, Tabs, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { type Project, fileById } from '../core/project/types';
import type { ProjectAnalysis } from '../core/project/analysis';
import { useProject } from '../store';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
import { targetStatus } from '../core/project/profiles';
import { readYaml } from '../core/documents/yaml';
import { collectReferences } from '../core/project/references';
import { textOf } from '../core/project/types';
import { starterData } from '../core/project/templates';
import { lazy, Suspense, useEffect, useState } from 'react';
const BusTopology = lazy(() => import('../components/BusTopology'));
import { igh, ighFlat, ecm } from '../core/documents/config-fields';
const ighDefaults:Record<string,unknown>=starterData().igh;
type MasterProps={p:Project;analysis?:ProjectAnalysis;dark:boolean};
export function Master(props:MasterProps) {
  const {p,analysis}=props;const message=useLocalizedMessage();
  const catalog=analysis?.catalog, file=fileById(p,p.entrypoints.master.fileId);
  const actions=file&&catalog&&targetStatus(p,'master').supported?<>{p.entrypoints.master.kind==='igh'&&<Button onClick={()=>{if(p.editor.buffers[file.id]){message.error(()=>(t("请先应用源码草稿")));return;}if(catalog.diagnostics.some(d=>d.severity==='error')){message.error(()=>(t("请先修复主站配置错误")));return;}try{const bytes=exportMaster(p);download(bytes,collectReferences(p).some(r=>r.sourceFileId===file.id&&r.field==='eni')?'igh-config.zip':'igh.yaml');message.success(()=>(t("已生成主站文件下载")));}catch(e){message.error(()=>errorText(e,true));}}}>{t("导出 ROCOS-IGH 主站文件")}</Button>}{masterKinds(p).length>1&&<Button onClick={()=>useProject.getState().change(n=>{const old=n.entrypoints.master.kind;selectMaster(n,old==='igh'?'ecm':'igh');configure(n).disabledMasters=[...(configuration(n).disabledMasters??[]),old];if(configuration(n).appMaster===old)selectAppMaster(n,n.entrypoints.master.kind);})}>{t("停用当前主站")}</Button>}</>:null;
  return <><div className="page-heading"><div><h1>{t("主站配置")}</h1><p>{t("先定义总线，再关联机器人硬件。")}</p></div><Space wrap className="master-primary-actions"><EniImport/>{masterKinds(p).length>1&&<Button disabled={!catalog} onClick={()=>{try{if(catalog?.masterId===undefined||catalog.cycleUs===undefined)throw new Error("请先填写主站 ID 和周期");useProject.getState().change(n=>synchronizeBus(n,catalog.masterId!,catalog.cycleUs!));}catch(e){message.error(()=>errorText(e,true));}}}>{t("同步公共 ID / 周期到两个主站")}</Button>}<ConfigurationImportMenu targets={['ecm','igh']}/>{actions}</Space></div>
    <Tabs className="master-tabs configuration-tabs" activeKey={p.entrypoints.master.kind} onChange={kind=>useProject.getState().change(n=>selectMaster(n,kind as 'igh'|'ecm'))} items={(['igh','ecm'] as const).map(kind=>({key:kind,label:kind.toUpperCase(),children:kind===p.entrypoints.master.kind?<MasterContent key={kind} {...props}/>:null}))}/></>;
}
function MasterContent({p,analysis,dark}:MasterProps) {
  const file=fileById(p,p.entrypoints.master.fileId),eni=fileById(p,collectReferences(p).find(r=>r.sourceFileId===p.entrypoints.master.fileId&&r.field==='eni')?.targetFileId);const message=useLocalizedMessage();
  const [pdoPreset,setPdoPreset]=useState<DevicePreset>('blank');
  const [tab,setTab]=useState('slaves');
  const diagnostic=useDiagnosticRequest();
  useEffect(()=>{if(diagnostic&&diagnostic.fileId===file?.id&&diagnostic.mode==='field'&&diagnostic.index!==undefined)setTab('edit');},[diagnostic]);
  if(!analysis)return null;
  const catalog=analysis.catalog;
  if(!file)return <Alert type="warning" message={t("请导入主站配置")}/>;
  const status=targetStatus(p,'master');
  if(!status.supported)return <><Alert type="error" message={diagnosticText(status)} description={t("可查看和保留原文；请在工程总览核对目标规则。")}/><SourceEditor file={file}/>{eni&&<SourceEditor file={eni}/>}</>;
  let data:any={};try{data=readYaml(textOf(file))??{};}catch{/* Source editor retains invalid YAML for repair. */}
  const editable=p.entrypoints.master.kind==='igh'&&data.eni===undefined;
  const legacy=data.master!==undefined;
  const startupFields=(legacy?igh:ighFlat.filter(f=>f.path!=='eni'||data.eni!==undefined)).map(field=>{
    const key=field.path.split('.').at(-1)!,flat=({master_id:'id',period_us:'cycle',cpu:'cpuidx'} as Record<string,string>)[key]??key;
    const defaultValue=flat==='cycle'?catalog.cycleUs:flat==='id'?catalog.masterId:flat==='dc'?(data.eni!==undefined?undefined:'off'):ighDefaults[flat];
    return {...field,defaultValue,...(data.eni!==undefined&&flat==='dc'?{help:'省略时沿用 ENI 的 DC 设置'}:{})};
  });
  const addSlave=()=>{try{useProject.getState().change(next=>Object.assign(next,planSlaveChange(next,{kind:'add',preset:pdoPreset}).project));}catch(e){message.error(()=>(errorText(e,true)));}};
  return <>
    <Card title={t("启动参数")} extra={<Tag>{t("目标")}{p.targets.master.version}</Tag>}><Fields file={file} fields={p.entrypoints.master.kind==='igh'?startupFields:ecm}/></Card>
    <Card title={t("总线配置视图")} className="space-top" extra={editable?<Space wrap><PdoTemplateSelect value={pdoPreset} onChange={setPdoPreset}/><Button icon={<PlusOutlined aria-hidden />} onClick={addSlave}>{t("新增从站")}</Button></Space>:<Tag color="gold">{t("来自 ENI · 只读")}</Tag>}>
      {editable&&pdoPreset!=='blank'&&<p className="muted">{pdoTemplateDescription(pdoPreset)}</p>}
      <Tabs activeKey={tab} onChange={setTab} items={[
        {key:'slaves',label:t('从站 ({count})',{count:catalog.slaves.length}),children:<SlaveTable p={p} slaves={catalog.slaves} editable={editable}/>},
        {key:'signals',label:t('过程映像 ({count})',{count:catalog.signals.length}),children:<ProcessImage signals={catalog.signals}/>},
        ...(editable?[{key:'edit',label:t("PDO / SDO 编辑"),children:<IghEditor p={p} preset={pdoPreset}/>}]:[]),
        {key:'source',label:t("源文件"),children:<SourceEditor file={file}/>},
        ...(eni?[{key:'eni',label:t("ENI 原文 · 只读"),children:<SourceEditor file={eni}/>}]:[])
      ]}/>
      {catalog.diagnostics.map((d,i)=><Alert className="space-top" key={i} type={d.severity==='error'?'error':'warning'} showIcon message={diagnosticText(d)}/>)}
    </Card>
    <Suspense fallback={null}><BusTopology catalog={catalog} kind={p.entrypoints.master.kind} dark={dark}/></Suspense>
  </>;
}
