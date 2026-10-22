import { t } from '../i18n';
import { Resources } from '../components/Resources';
import { Card, Select, Space } from 'antd';
import { useState } from 'react';
import { type Project, fileById } from '../core/project/types';
import { app } from '../core/documents/config-fields';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
export function AppConfig({p}:{p:Project}) {
  const file=fileById(p,p.entrypoints.app);const [selected,setSelected]=useState('');const source=fileById(p,selected)||file;if(!file)return null;
  return <><div className="page-heading"><div><h1>{t("APP 配置")}</h1><p>{t("配置启动参数与资源路径；路径相对于 APP config.yaml。")}</p></div></div><Card title={t("启动与通信")}><Fields file={file} fields={app}/></Card><Card className="space-top" title={t("工程文件")} extra={<Select style={{width:320}} value={source?.id} onChange={setSelected} options={p.files.filter(f=>/\.(ya?ml|urdf|xml|json)$/i.test(f.path)).map(f=>({value:f.id,label:f.path}))}/>}><Space/>{source&&<SourceEditor file={source}/>}</Card><Resources p={p}/></>;
}
