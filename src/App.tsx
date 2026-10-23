import { configuration, configure, enableSimulation, applicationProject } from './core/project/configuration';
import { ApplicationNavigation } from './components/ApplicationNavigation';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { Modules } from './components/Modules';
import { useUrdfImport } from './components/UrdfImport';
import { PdoTemplateSelect, pdoTemplateDescription } from './components/PdoTemplateSelect';
import type { DevicePreset } from './core/project/templates';
import { ParameterLabel } from './components/ParameterHelp';
import { DiagnosticContext, type DiagnosticRequest } from './components/DiagnosticNavigation';
import { diagnosticLocation } from './core/diagnostics/location';
import { SourceEditor } from './components/SourceEditor';
import { WorkspaceNavigation } from './components/WorkspaceNavigation';
import { WorkspaceActions } from './components/WorkspaceActions';
import { ConfigurationImportMenu } from './components/ConfigurationImportMenu';
import { QuickNavigation } from './components/QuickNavigation';
import { configurationStatus } from './core/project/configuration-status';
import { useCardHoverMotion } from './components/useCardHoverMotion';
import { loadTalonExample } from './core/project/talon-example';
import { useLocalizedMessage } from './components/useLocalizedMessage';
import { m as msg, MessageError } from './core/project/messages';
import { useLocalizedModal } from './components/useLocalizedModal';
import { errorText, diagnosticText, persistenceText, setLocale, t, useLocale, type Locale } from './i18n';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Alert, Badge, Button, Card, Checkbox, ConfigProvider, Dropdown, Empty, Input, Modal, Select, Space, Statistic, Table, Tag, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { ApartmentOutlined, ApiOutlined, CheckCircleOutlined, DownloadOutlined, FileAddOutlined, FolderOpenOutlined, GlobalOutlined, MoonOutlined, RedoOutlined, SaveOutlined, SettingOutlined, SunOutlined, UndoOutlined } from '@ant-design/icons';
import { flushBuffers, useProject } from './store';
import { RecoveryFiles } from './components/RecoveryFiles';
import { createProject } from './core/project/create';
import { fileById, textOf, type MasterKind, type Project, type Diagnostic } from './core/project/types';
import { useProjectAnalysis } from './components/useProjectAnalysis';
import { runArchiveTask } from './adapters/archive-tasks';
import { download } from './adapters/files';
import { fileAccess, readBrowserFile } from './adapters/file-access';
import { useProjectFiles } from './components/ProjectFiles';
import { useImportDialog } from './components/ImportDialog';
import { OfflineStatus } from './components/OfflineStatus';
import { createModelViewState } from './components/modelViewState';
const Simulation = lazy(() => import('./pages/Simulation').then(module => ({ default: module.Simulation })));
const Master = lazy(() => import('./pages/Master').then(module => ({ default: module.Master })));
const Robot = lazy(() => import('./pages/Robot').then(module => ({ default: module.Robot })));
const Hardware = lazy(() => import('./pages/Hardware').then(module => ({ default: module.Hardware })));
const AppConfig = lazy(() => import('./pages/AppConfig').then(module => ({ default: module.AppConfig })));
const pages=[{key:'overview',label:'工程总览',icon:<FolderOpenOutlined aria-hidden/>},{key:'master',label:'01 总线配置',icon:<ApiOutlined aria-hidden/>},{key:'app',label:'02 应用配置',icon:<SettingOutlined aria-hidden/>},{key:'simulation',label:'03 仿真配置',icon:<ApartmentOutlined aria-hidden/>},{key:'export',label:'04 校验和导出',icon:<CheckCircleOutlined aria-hidden/>}];
function Workspace({dark,toggle}:{dark:boolean;toggle:()=>void}) {
  const cardHoverMotion=useCardHoverMotion();
  const locale=useLocale();
  const {selectFiles,dialog:importDialog}=useImportDialog();
  const urdfImport=useUrdfImport(selectFiles);
  const state=useProject(),p=state.project;const message=useLocalizedMessage();const modal=useLocalizedModal();
  const modelView = useRef({ epoch: state.workspaceEpoch, value: createModelViewState() });
  if (modelView.current.epoch !== state.workspaceEpoch) modelView.current = { epoch: state.workspaceEpoch, value: createModelViewState() };
  const [route,setRoute]=useState(location.hash.slice(2)||'overview'),[newOpen,setNewOpen]=useState(false),[name,setName]=useState('我的机器人'),[kind,setKind]=useState<MasterKind>('igh'),[busy,setBusy]=useState(false);
  const [appTab,setAppTab]=useState('startup');
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [newModules,setNewModules]=useState<string[]>(['bus','app']);
  const [pdoPreset,setPdoPreset]=useState<DevicePreset>('blank');
  const [robotSeed,setRobotSeed]=useState('blank'),[robotPrefix,setRobotPrefix]=useState('arm'),[robotLength,setRobotLength]=useState(0.3);
  const [report,setReport]=useState<{projectId:string;epoch:number;revision:number;items:Diagnostic[]}|null>(null);
  const [reveal,setReveal]=useState<DiagnosticRequest>();const revealCounter=useRef(0);
  const picker=useRef<HTMLInputElement>(null);
  const files=useProjectFiles(()=>{setReport(null);setReveal(undefined);setRoute('overview');location.hash='/overview';});
  useEffect(()=>{const listener=()=>setRoute(location.hash.slice(2)||'overview');addEventListener('hashchange',listener);return()=>removeEventListener('hashchange',listener);},[]);
  useEffect(()=>{const listener=(e:BeforeUnloadEvent)=>{const current=useProject.getState();if(!files.native&&current.project&&current.project.revision!==current.savedRevision){e.preventDefault();e.returnValue='';}};addEventListener('beforeunload',listener);return()=>removeEventListener('beforeunload',listener);},[]);
  const navigate=(key:string)=>{setReveal(undefined);location.hash='/'+key;};
  const run=async(fn:()=>Promise<void>|void)=>{setBusy(true);try{await fn();}catch(e){message.error(()=>(errorText(e)));}finally{setBusy(false);}};
  const save=()=>files.save();
  const replace=(next:Project)=>files.replace(next);
  const openExample=()=>{if(busy||files.busy)return;void run(async()=>{await replace(await loadTalonExample());});};
  const createSelected=(next:Project)=>{configure(next).enabled={bus:newModules.includes('bus'),app:newModules.includes('app'),simulation:false};if(newModules.includes('simulation'))enableSimulation(next);return next;};
  const diagnose=()=>void files.compute(async options=>{
    await flushBuffers();const captured=useProject.getState();if(!captured.project)return;
    navigate('export');const snapshot=captured.project;
    const items=await runArchiveTask({kind:'validate',project:snapshot},options);
    if(useProject.getState().workspaceEpoch===captured.workspaceEpoch)setReport({projectId:snapshot.id,epoch:captured.workspaceEpoch,revision:snapshot.revision,items});
  });
  const exportConfiguration=(directory=false)=>files.compute(async options=>{
    await flushBuffers();const captured=useProject.getState();if(!captured.project)return;
    const snapshot=captured.project;
    const result=await runArchiveTask({kind:directory?'runtimeDirectory':'runtime',project:snapshot},options);
    const current=()=>useProject.getState().workspaceEpoch===captured.workspaceEpoch&&useProject.getState().project?.revision===snapshot.revision;
    if(!current()){message.info(()=>(t("工程已变化，请重新检查导出计划")));return;}
    setReport({projectId:snapshot.id,epoch:captured.workspaceEpoch,revision:snapshot.revision,items:result.diagnostics});
    if(!result.prepared){message.error(()=>(t("运行配置仍有错误，请先修复诊断结果")));return;}
    const prepared=result.prepared,{plan}=prepared;
    modal.confirm(()=>({title:t("运行包导出计划"),width:760,content:<div><p>{directory?t("将在所选父目录中创建独立目录，不覆盖已有配置。"):''}{t('将导出 {count} 个文件，来自 revision {revision}。消费端、SDK 与实机验证尚未执行。',{count:plan.files.length,revision:snapshot.revision})}</p><ul>{plan.rewrites.map((r,i)=><li key={i}>{snapshot.files.find(f=>f.id===r.fileId)?.path} · {r.field}<br/>{r.from} → {r.to}</li>)}</ul>{!!plan.external.length&&<Alert type="warning" message={t('包含 {count} 项目标环境依赖，详见包内 ROCOS-DEPLOYMENT.txt。',{count:plan.external.length})}/>}<details><summary>{t("文件清单")}</summary><ul>{plan.files.map(f=><li key={f.path}>{f.path}</li>)}</ul></details></div>,okText:directory?t("选择父目录并导出"):t("下载运行包"),onOk:()=>{if(!current()){message.error(()=>(t("工程已变化，请重新检查导出计划")));return;}if('bytes' in prepared)return download(prepared.bytes,snapshot.name+'-config.zip');
      return files.compute(async options=>{
        const access=fileAccess();if(!access.writeDirectory)throw new MessageError(msg("当前环境不支持目录导出，请使用 ZIP"));
        const written=await access.writeDirectory(prepared.plan.files,snapshot.name,options);
        if(written)modal.success(()=>({title:t("运行目录已导出"),content:<div><p>{written.displayPath}</p><p>{t(files.native?'{count} 个文件已写入并校验。当前工程与保存目标保持不变。':'{count} 个文件已写入。',{count:written.files})}</p>{written.warning&&<Alert type="warning" message={diagnosticText({message:written.warning,text:written.warningText})}/>}</div>}));
      });}}));
  });
  const analysis=useProjectAnalysis(p,state.workspaceEpoch),catalog=analysis.data?.catalog;
  const appAnalysis=useProjectAnalysis(p?applicationProject(p):null,state.workspaceEpoch);
  const diagnostics=report?.items||[];const errors=diagnostics.filter(d=>d.severity==='error').length;
  const configStatus=useMemo(()=>p&&route==='overview'?configurationStatus(p):undefined,[p,route]);
  const reportCurrent=!!p&&report?.projectId===p.id&&report.epoch===state.workspaceEpoch&&report.revision===p.revision;
  const locationSession=reveal&&p&&reveal.projectId===p.id&&reveal.epoch===state.workspaceEpoch&&reveal.route===route?reveal:undefined;
  const destination=locationSession?.revision===p?.revision?locationSession:undefined;
  const sourceFile=locationSession?.mode==='source'?fileById(p!,locationSession.fileId):undefined;
  const locate=async(d:Diagnostic)=>{
    await flushBuffers();const current=useProject.getState(),project=current.project;
    if(!project||report?.projectId!==project.id||report.epoch!==current.workspaceEpoch||report.revision!==project.revision){message.info(()=>t('诊断结果已过期，请重新校验后定位。'));return;}
    const target=diagnosticLocation(project,d),file=target&&fileById(project,target.fileId);if(!target||!file)return;
    const source=textOf(file),draft=project.editor.buffers[file.id];
    setReveal({...target,issue:d,projectId:project.id,epoch:current.workspaceEpoch,revision:project.revision,request:++revealCounter.current,source,editorText:draft?.text??source,draft:!!draft});
    location.hash='/'+target.route;setRoute(target.route);
  };
  return <div className="shell" data-project-id={p?.id} data-project-revision={p?.revision} data-workspace-epoch={state.workspaceEpoch} data-theme={dark?'dark':'light'}>
    <OfflineStatus hidden/>
    <WorkspaceNavigation items={pages} route={['robot','hardware','binding','payload'].includes(route)?'app':route} hasProject={!!p} navigate={navigate}/>
    <div className="main-shell"><header className="topbar">
      <div className="project-name"><span className="eyebrow">{t("ROCOS / 工程配置")}</span><strong title={p?.name}>{p?.name||t("开始一个新工程")}</strong><span className="save-state" title={files.destination}>{persistenceText(state.persistence)}</span></div>
      <WorkspaceActions>
        {p?.editor.templateUses?.some(use=>use.templateId==='project.teaching')&&<Tag className="topbar-status" color="orange">{t('教学示例')}</Tag>}
        {p?.editor.templateUses?.some(use=>use.templateId==='project.talon')&&<Tag className="topbar-status" color="blue">{t('Talon 示例')}</Tag>}
        <RecoveryFiles replace={files.replace} disabled={busy||files.busy}/>
        <Dropdown menu={{selectedKeys:[locale],items:[{key:'zh-CN',label:'简体中文'},{key:'en-US',label:'English'}],onClick:({key})=>setLocale(key as Locale)}} trigger={['click']}><Button aria-label={t('切换语言')} icon={<GlobalOutlined aria-hidden/>}/></Dropdown>
        <Button aria-label={t("切换主题")} icon={dark?<SunOutlined aria-hidden />:<MoonOutlined aria-hidden />} onClick={toggle}/>
        <Button aria-label={t("设置")} icon={<SettingOutlined aria-hidden />} onClick={()=>setSettingsOpen(true)}/>
      </WorkspaceActions>
      <div className="project-file-actions"><Button icon={<FolderOpenOutlined aria-hidden />} disabled={busy||files.busy} onClick={()=>void files.open()}>{t("打开工程")}</Button><Button type="primary" icon={<SaveOutlined aria-hidden />} disabled={!p||busy||files.busy} onClick={()=>void save()}>{files.native?t("保存工程"):t("下载工程")}</Button>{files.native&&<Button disabled={!p||busy||files.busy} onClick={()=>void files.save('saveAs')}>{t("另存为")}</Button>}</div>
    </header>
    <main onPointerOver={cardHoverMotion} className={p&&route==='overview'?"workspace workspace-overview":"workspace"}><DiagnosticContext.Provider value={destination}>{destination&&<Alert className="diagnostic-location" type="info" message={t("诊断位置")} description={<><p>{diagnosticText(destination.issue)}</p>{p?.files.find(f=>f.id===destination.fileId)?.path}{destination.field&&<> · <code>{destination.field}</code></>}{destination.draft&&<p>{t("诊断基于已应用配置；当前源码草稿保持不变，请先核对草稿。")}</p>}</>} action={<Button onClick={()=>navigate("export")}>{t("返回诊断结果")}</Button>}/>}<Suspense fallback={<p role="status">{t("正在打开配置页面…")}</p>}>
      {!p?<div className="welcome"><div className="welcome-eyebrow">ROCOS CONFIGURATOR</div><h1>{t("让机器人的配置，")}<br/>{t("清晰而有序。")}</h1><p>{t("从 EtherCAT 主站到机器人模型，在一个工程中完成配置、检查与留存。")}</p><div className="welcome-actions"><Button size="large" type="primary" icon={<FileAddOutlined aria-hidden />} onClick={()=>setNewOpen(true)}>{t("新建工程")}</Button><Button size="large" icon={<FolderOpenOutlined aria-hidden />} disabled={busy||files.busy} onClick={()=>void files.open()}>{t("打开 .rcproj")}</Button><Button size="large" icon={<FolderOpenOutlined aria-hidden />} loading={busy} disabled={files.busy} onClick={openExample}>{t('打开示例')}</Button></div><div className="welcome-steps">{t("01 总线配置")}<span>→</span> {t("02 应用配置")}<span>→</span> {t("03 仿真配置")}<span>→</span> {t("04 校验与导出")}</div><div className="welcome-cards"><Card title={t("两类主站，同一工作流")}>{t("编辑 ROCOS-IGH 配置，或导入 ROCOS-ECM 的 ENI。保留各自原生格式。")}</Card><Card title={t("一份工程，完整留存")}>{t(".rcproj 归档配置、模型资源与未完成的编辑草稿。")}</Card><Card title={t("本地处理，直接导出")}>{t("配置文件在当前设备处理，不上传至业务服务器。")}</Card></div></div>:<>
        {route==='overview'&&<div className="overview-page"><div className="page-heading"><div><h1>{t("工程总览")}</h1><p>{t("先完成主站，再关联模型与硬件。每一步都可以保存。")}</p></div><Space wrap><Button onClick={()=>setNewOpen(true)}>{t("新建工程")}</Button><Button loading={busy} disabled={files.busy} onClick={openExample}>{t('打开示例')}</Button></Space></div><div className="stats"><Card><Statistic title={t("配置状态")} value={`${configStatus?.configured ?? 0} / ${configStatus?.total ?? 0}`} aria-label={t("已配置文件数量 / 总配置文件数量")}/></Card><Card><Statistic title={t("已解析从站")} value={catalog?.slaves.length??'—'}/></Card><Card><Statistic title={t("机器人关节数")} value={analysis.pending?'—':analysis.data?.chain.length||t("未配置")}/></Card><Card><Statistic title={t("机器人工具数量")} value={t("未配置")}/></Card></div><div className="overview-grid"><Card title={t("配置步骤")}>{pages.slice(1).map((step,i)=><button className="step-row" key={step.key} onClick={()=>navigate(step.key)}><span className="step-number">0{i+1}</span><span><strong>{t(step.label)}</strong><small>{[t("设置周期、从站与 PDO"),t("模型、硬件、绑定与负载"),t("MJCF 模型与仿真参数"),t("检查完整性并生成配置包")][i]}</small></span><span className="step-arrow">→</span></button>)}</Card><Card title={t("工程信息")}><div className="field-label"><ParameterLabel htmlFor="project-name" role="project" path="name">{t("工程名称")}</ParameterLabel></div><Input id="project-name" key={`name-${state.workspaceEpoch}`} defaultValue={p.name} onBlur={e=>{if(e.target.value!==p.name)state.change(n=>{n.name=e.target.value;});}}/><div className="field-label"><ParameterLabel htmlFor="project-description" role="project" path="description">{t("说明")}</ParameterLabel></div><Input.TextArea id="project-description" key={`description-${state.workspaceEpoch}`} rows={3} defaultValue={p.description} onBlur={e=>{if(e.target.value!==p.description)state.change(n=>{n.description=e.target.value;});}}/><div className="meta-list"><p><span>{t("创建时间")}</span>{new Date(p.createdAt).toLocaleString(locale)}</p><p><span>{t("当前编辑版本")}</span>{p.revision}</p><p><span>{t("APP 目标")}</span>{p.targets.app.version}</p><p><span>{t("设备验证")}</span>{t("尚未执行")}</p></div><Alert type="info" showIcon message={t("工程可随时保存；有错误的配置不会被标记为可部署。")}/></Card></div><QuickNavigation/></div>}
        {analysis.pending&&<p role="status">{t("正在后台解析当前工程的总线与模型…")}</p>}
        {analysis.error&&<Alert type="error" message={diagnosticText({message:analysis.error,text:analysis.errorTemplate})} action={<Button onClick={analysis.retry}>{t("重新解析")}</Button>}/>}
        {sourceFile?<Card className="space-top diagnostic-source" title={sourceFile.path} extra={<Button onClick={()=>setReveal(undefined)}>{t("返回配置页面")}</Button>}><SourceEditor file={sourceFile} diagnostic={destination}/></Card>:<>
        {route==='master'&&(configuration(p).enabled.bus?<Master p={p} analysis={analysis.data} dark={dark}/>:<Empty description={t("此模块尚未启用，请在设置中启用。")}> <Button onClick={()=>setSettingsOpen(true)}>{t("打开设置")}</Button></Empty>)}
        {['app','robot','hardware','binding','payload'].includes(route)&&(configuration(p).enabled.app?<>
          <ApplicationNavigation actions={<ConfigurationImportMenu targets={['urdf','hardware','app.payload']}/>} activeKey={route==='app'?appTab:route} onChange={key=>{setAppTab(key);navigate(key==='startup'?'app':key);}}>
          {(route==='app'?appTab:route)==='startup'&&<AppConfig p={p}/>}
          {(route==='app'?appTab:route)==='robot'&&<Robot key={state.workspaceEpoch} p={p} analysis={analysis.data} onImport={urdfImport.open} viewState={modelView.current.value} dark={dark}/>}
          {['hardware','binding'].includes(route==='app'?appTab:route)&&<Hardware p={p} analysis={appAnalysis.data} view={(route==='app'?appTab:route)==='binding'?'binding':'hardware'}/>}
          {(route==='app'?appTab:route)==='payload'&&<Modules p={p}/>}
          </ApplicationNavigation>
        </>:<Empty description={t("此模块尚未启用，请在设置中启用。")}> <Button onClick={()=>setSettingsOpen(true)}>{t("打开设置")}</Button></Empty>)}
        {route==='simulation'&&(configuration(p).enabled.simulation?<Simulation p={p}/>:<Empty description={t("此模块尚未启用，请在设置中启用。")}> <Button onClick={()=>setSettingsOpen(true)}>{t("打开设置")}</Button></Empty>)}
        </>}
        {route==='export'&&<><div className="page-heading"><div><h1>{t("校验与导出")}</h1><p>{t("工程存档和运行配置分别生成，静态校验不代表实机验证。")}</p></div><Button type="primary" disabled={busy||files.busy} onClick={diagnose}>{t("重新校验")}</Button></div><div className="export-grid"><Card title={t("工程归档 · .rcproj")}><p>{t("包含配置、资源和编辑草稿。导出副本保留工程身份；复制为新工程生成独立身份，打开后可单独维护。两种操作均保留当前工作区与保存目标。")}</p><Space wrap><Button icon={<SaveOutlined aria-hidden />} disabled={files.busy} onClick={()=>void files.save('copy')}>{t("导出工程副本")}</Button><Button disabled={files.busy} onClick={()=>void files.save('fork')}>{t("复制为新工程")}</Button></Space></Card><Card title={files.native?t("运行配置 · ZIP / 目录"):t("运行配置 · .zip")}><p>{t("仅导出配置与资源；需要先修复全部阻塞问题。")}</p><Button icon={<DownloadOutlined aria-hidden />} disabled={busy||files.busy} onClick={()=>void exportConfiguration()}>{t("检查并导出配置")}</Button>{<Button className="space-top" disabled={busy||files.busy} onClick={()=>void exportConfiguration(true)}>{t("导出到新目录")}</Button>}</Card></div><Card title={t("诊断结果")} className="space-top" extra={report?<Tag color={!reportCurrent?'orange':errors?'red':'green'}>{!reportCurrent?t("结果已过期"):t('{count} 项错误',{count:errors})}</Tag>:<Tag>{t("未校验")}</Tag>}><Table className="diagnostic-table" scroll={{x:1100}} rowKey={(_,i)=>String(i)} dataSource={diagnostics} columns={[{title:t("级别"),dataIndex:'severity',width:100,render:v=><Tag color={v==='error'?'red':v==='warning'?'orange':'blue'}>{v}</Tag>},{title:t("问题"),dataIndex:'message',render:(_,d)=>diagnosticText(d)},{title:t("规则"),dataIndex:'code'},{title:t("文件"),dataIndex:'fileId',render:id=>p.files.find(f=>f.id===id)?.path||'—'},{title:t("字段 / 对象"),dataIndex:'field',render:value=>value||'—'},{title:t("操作"),render:(_,d)=><Button aria-label={t("定位")} disabled={!reportCurrent||busy||files.busy||!d.fileId||!p.files.some(f=>f.id===d.fileId)} onClick={()=>void run(()=>locate(d))}>{t("定位")}</Button>}]} locale={{emptyText:t("点击“校验”检查当前工程")}}/></Card><Card title={t("文件清单")} className="space-top"><Table scroll={{x:700}} rowKey="id" dataSource={p.files} columns={[{title:t("路径"),dataIndex:'path'},{title:t("用途"),dataIndex:'role'},{title:t("大小"),render:(_,f)=>`${f.bytes.length.toLocaleString()} B`},{title:t("内容"),render:(_,f)=><Button size="small" onClick={()=>run(()=>download(f.bytes,f.path.split('/').at(-1)!))}>{t("下载原/当前文件")}</Button>}]} /></Card></>}
      </>}
    </Suspense></DiagnosticContext.Provider></main><footer className="bottom-bar"><Space><Button icon={<UndoOutlined aria-hidden />} disabled={!state.past.length} onClick={state.undo}>{t("撤销")}</Button><Button icon={<RedoOutlined aria-hidden />} disabled={!state.future.length} onClick={state.redo}>{t("重做")}</Button><span className="muted">{p?t('本地编辑 · {count} 个文件',{count:p.files.length}):t("准备就绪")}</span></Space><Space><Button disabled={!p} onClick={()=>navigate(pages[Math.max(0,pages.findIndex(i=>i.key===(['robot','hardware','binding','payload'].includes(route)?'app':route))-1)].key)}>{t("上一步")}</Button><Button disabled={!p} onClick={()=>navigate(pages[Math.min(pages.length-1,pages.findIndex(i=>i.key===(['robot','hardware','binding','payload'].includes(route)?'app':route))+1)].key)}>{t("下一步")}</Button><Button type="primary" disabled={!p||busy||files.busy} onClick={diagnose}>{t("校验工程")}</Button></Space></footer></div>
    <Modal title={t("设置")} open={settingsOpen} onCancel={()=>setSettingsOpen(false)} footer={null}>{p?<ConfigurationPanel p={p}/>:<Empty description={t("请先创建或打开工程")}/>}</Modal>
    <Modal title={t("新建配置工程")} open={newOpen} onCancel={()=>setNewOpen(false)} okText={t("创建工程")} okButtonProps={{disabled:!newModules.length}} onOk={()=>{try{void replace(createSelected(createProject(name.trim()||'未命名工程',kind,{pdoTemplate:newModules.includes('bus')&&kind==='igh'?pdoPreset:'blank',...(newModules.includes('app')&&robotSeed==='robot.two-axis'?{robotTemplate:'robot.two-axis' as const,parameters:{prefix:robotPrefix,linkLength:robotLength}}:{})})));setNewOpen(false);}catch(e){message.error(()=>(errorText(e,true)));}}}><Checkbox.Group value={newModules} onChange={v=>setNewModules(v as string[])} options={[{label:t("总线配置"),value:"bus"},{label:t("应用配置"),value:"app"},{label:t("仿真配置"),value:"simulation"}]}/><div className="field-label"><ParameterLabel htmlFor="new-project-name" role="project" path="name">{t("工程名称")}</ParameterLabel></div><Input id="new-project-name" value={name} onChange={e=>setName(e.target.value)}/>{newModules.includes('bus')&&<><div className="field-label"><ParameterLabel htmlFor="new-project-kind" role="project" path="kind">{t("主站类型")}</ParameterLabel></div><Select id="new-project-kind" aria-label={t("主站类型")} value={kind} onChange={setKind} style={{width:'100%'}} options={[{value:'igh',label:'ROCOS-IGH'},{value:'ecm',label:'ROCOS-ECM'}]}/>{kind==='igh'&&<><div className="field-label"><label htmlFor="new-project-pdo">{t('PDO 模板')}</label></div><PdoTemplateSelect id="new-project-pdo" value={pdoPreset} onChange={setPdoPreset}/><p className="muted">{pdoTemplateDescription(pdoPreset)}</p></>}</>}{newModules.includes('app')&&<><div className="field-label"><ParameterLabel htmlFor="new-project-template" role="project" path="template">{t("初始模型模板")}</ParameterLabel></div><Select id="new-project-template" aria-label={t("初始模型模板")} value={robotSeed} onChange={setRobotSeed} style={{width:'100%'}} options={[{value:'blank',label:t("空白工程")},{value:'robot.two-axis',label:t("双关节演示模型")}]}/>{robotSeed==='robot.two-axis'&&<><div className="field-label"><ParameterLabel htmlFor="new-project-prefix" role="project" path="prefix">{t("模型名称前缀")}</ParameterLabel></div><Input id="new-project-prefix" aria-label={t("模型名称前缀")} value={robotPrefix} onChange={e=>setRobotPrefix(e.target.value)}/><div className="field-label"><ParameterLabel htmlFor="new-project-length" role="project" path="length">{t("连杆长度（m）")}</ParameterLabel></div><Input id="new-project-length" aria-label={t("模板连杆长度")} type="number" min={0.001} max={10} step={0.01} value={robotLength} onChange={e=>setRobotLength(Number(e.target.value))}/><p>{t("教学模型的限位、速度和力矩是演示值，需对照实机核对；不生成驱动器换算或绑定。")}</p></>}</>}<p className="muted">{t("配置文件在本机处理。创建后可随时保存 .rcproj。")}</p></Modal>
    {importDialog}{files.dialogs}
    <input hidden type="file" accept=".rcproj,.zip" ref={picker} onChange={e=>{const f=e.target.files?.[0];if(f)void readBrowserFile(f).then(opened=>files.accept(opened)).catch(e=>message.error(()=>(errorText(e,true))));e.target.value='';}}/>
    {urdfImport.dialog}
  </div>;
}
export default function Application(){const locale=useLocale();useEffect(()=>{document.documentElement.lang=locale;},[locale]);const [dark,setDark]=useState(localStorage.getItem('rocos-theme')==='dark');return <ConfigProvider locale={locale==='zh-CN'?zhCN:enUS} theme={{algorithm:dark?theme.darkAlgorithm:theme.defaultAlgorithm,token:{colorPrimary:'#2563eb',borderRadius:8,controlHeight:44,fontFamily:'var(--config-font-family)',fontSize:14,motion:false},components:{Card:{borderRadiusLG:16},Menu:{darkItemBg:'#192b45',darkSubMenuItemBg:'#192b45',itemHeight:48}}}}><AntApp><Workspace dark={dark} toggle={()=>{setDark(!dark);localStorage.setItem('rocos-theme',String(!dark?'dark':'light'));}}/></AntApp></ConfigProvider>;}
