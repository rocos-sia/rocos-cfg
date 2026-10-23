import { t } from '../i18n';
import { lazy, Suspense, useState } from 'react';
import { Alert, Button, Card, Empty, Select } from 'antd';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
import { configuration } from '../core/project/configuration';
import { fileById, textOf, type Project } from '../core/project/types';
import { readYaml } from '../core/documents/yaml';
import { buildBusCatalog } from '../core/bus/catalog';
import { relativePath, resolvePath } from '../core/project/paths';
import { ConfigurationImportMenu } from '../components/ConfigurationImportMenu';
import { useProject } from '../store';
const MjcfPreview=lazy(()=>import('../components/MjcfPreview').then(m=>({default:m.MjcfPreview})));
export function Simulation({p}:{p:Project}) {
 const [error,setError]=useState(''),[preview,setPreview]=useState<{files:Project['files'];path:string}>();
 const file=fileById(p,configuration(p).simulationFileId);if(!file)return null;
 let config:any={};try{config=readYaml(textOf(file));}catch{/* Source editor remains available. */}
 const hardware=p.files.find(f=>f.path===resolvePath(file.path,config?.hardware_config??''));
 const run=async(fn:()=>void|Promise<void>)=>{try{setError('');await fn();}catch(e){setError(String(e));}};
 return <><div className="page-heading"><div><h1>{t("仿真配置 · ROCOS-MUJOCO")}</h1><p>{t("配置启动参数、共享 PDO 硬件和 MJCF 模型。")}</p></div><ConfigurationImportMenu targets={['mjcf','mujoco']}/></div>
 {error&&<Alert type="error" message={error}/>}
 <div className="simulation-bento">
 <Card title={t("MJCF 模型")} className="simulation-model"><div className="simulation-model-tools"><Select aria-label={t("MJCF 入口模型")} className="simulation-model-select" value={config?.model} options={p.files.filter(f=>f.role==='mjcf').map(f=>({label:f.path,value:relativePath(file.path,f.path)}))} onChange={v=>useProject.getState().yaml(file.id,['model'],v)}/><Button onClick={()=>void run(()=>{const path=resolvePath(file.path,config.model);if(!path||!p.files.some(f=>f.path===path))throw new Error('请先导入并选择模型');setPreview({files:p.files,path});})}>{t("加载模型预览")}</Button></div>{preview?<Suspense fallback={<p>{t("正在加载预览…")}</p>}><MjcfPreview {...preview}/></Suspense>:<div className="simulation-empty"><Empty description={t("导入 MJCF 文件并加载模型预览")}/></div>}</Card>
 <Card className="simulation-parameters" title={t("仿真启动参数")} extra={<Button disabled={!configuration(p).enabled.bus} onClick={()=>void run(()=>{const bus=buildBusCatalog(p);if(bus.diagnostics.some(d=>d.severity==='error'))throw new Error('请先修复总线配置');useProject.getState().yaml(file.id,['ecat_id'],bus.masterId);useProject.getState().yaml(file.id,['cycle_time_us'],bus.cycleUs);})}>{t("复用当前主站 ID / 周期")}</Button>}>
 <Fields file={file} fields={[{path:'ecat_id',label:'主站 ID',type:'number',min:0},{path:'cycle_time_us',label:'控制周期（μs）',type:'number',min:1,max:4294967295},{path:'duration_sec',label:'运行时长（s，-1 持续运行）',type:'number',min:-1},{path:'visualize',label:'启用仿真窗口',type:'boolean'},{path:'model',label:'模型相对路径',type:'text'},{path:'hardware_config',label:'硬件相对路径',type:'text'}]}/></Card>
 <Card title={t("仿真 Hardware / PDO")} className="simulation-hardware" extra={<Button disabled={!p.entrypoints.hardware} onClick={()=>void run(()=>{const source=fileById(p,p.entrypoints.hardware);if(!source||!hardware)throw new Error('缺少硬件配置');if(p.editor.buffers[source.id]||p.editor.buffers[hardware.id])throw new Error('请先处理源码草稿');useProject.getState().change(n=>{fileById(n,hardware.id)!.bytes=new Uint8Array(source.bytes);});})}>{t("复制 APP 硬件映射")}</Button>}><p>{t("复用后可独立修改；请核对 MJCF 关节名称、执行器顺序和 PDO 换算。")}</p>{hardware&&<SourceEditor file={hardware}/>}</Card><Card title={t("启动配置源码")} className="simulation-source"><SourceEditor file={file}/></Card></div></>;
}
