import { t } from '../i18n';
import { Card, Checkbox, Space } from 'antd';
import { configuration, configure, enableSimulation } from '../core/project/configuration';
import type { Project } from '../core/project/types';
import { useProject } from '../store';
export function ConfigurationPanel({p}:{p:Project}) {
 const config=configuration(p);
 return <Card title={t("工程配置模块")}><p>{t("按需启用一个或多个模块。停用模块保留配置文件，校验和运行导出只包含启用模块及其依赖。")}</p><Space wrap size="large">{([{key:'bus',label:'01 总线配置'},{key:'app',label:'02 应用配置'},{key:'simulation',label:'03 仿真配置'}] as const).map(m=><Checkbox key={m.key} checked={config.enabled[m.key]} onChange={e=>useProject.getState().change(n=>{if(m.key==='simulation'&&e.target.checked)enableSimulation(n);else configure(n).enabled[m.key]=e.target.checked;})}>{t(m.label)}</Checkbox>)}</Space></Card>;
}
