import { t } from '../i18n';
import { Button, Card, Checkbox, Space, Tag } from 'antd';
import { configuration, configure, enableSimulation, masterKinds, selectMaster } from '../core/project/configuration';
import type { Project } from '../core/project/types';
import { useProject } from '../store';
export function ConfigurationPanel({p}:{p:Project}) {
 const config=configuration(p);
 return <Card title={t("工程配置模块")} className="space-top"><p>{t("按需启用一个或多个模块。停用模块保留配置文件，校验和运行导出只包含启用模块及其依赖。")}</p><Space wrap size="large">{([{key:'bus',label:'01 总线配置'},{key:'app',label:'02 应用配置'},{key:'simulation',label:'03 仿真配置'}] as const).map(m=><Checkbox key={m.key} checked={config.enabled[m.key]} onChange={e=>useProject.getState().change(n=>{if(m.key==='simulation'&&e.target.checked)enableSimulation(n);else configure(n).enabled[m.key]=e.target.checked;})}>{t(m.label)}</Checkbox>)}</Space></Card>;
}
export function BusSelector({p,application=false}:{p:Project;application?:boolean}) {
 const kinds=masterKinds(p),selected=application?(configuration(p).appMaster??p.entrypoints.master.kind):p.entrypoints.master.kind;
 return <div className="module-subnav"><Space wrap>{(application?kinds:['igh','ecm'] as const).map(kind=><Button key={kind} type={selected===kind?'primary':'default'} onClick={()=>useProject.getState().change(n=>{if(application)configure(n).appMaster=kind;else selectMaster(n,kind);})}>{kind.toUpperCase()}{!kinds.includes(kind)?t(' · 添加'):''}</Button>)}<Tag>{t('当前 PDO 来源：')}{selected.toUpperCase()}</Tag>{!application&&kinds.length>1&&<Button onClick={()=>useProject.getState().change(n=>{const old=n.entrypoints.master.kind;selectMaster(n,old==='igh'?'ecm':'igh');configure(n).disabledMasters=[...(configuration(n).disabledMasters??[]),old];if(configuration(n).appMaster===old)configure(n).appMaster=n.entrypoints.master.kind;})}>{t("停用当前主站")}</Button>}</Space></div>;
}
