import { t } from '../i18n';
import { Resources } from '../components/Resources';
import { Card, Select } from 'antd';
import { useState } from 'react';
import { type Project, fileById } from '../core/project/types';
import { app } from '../core/documents/config-fields';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
export function AppConfig({p}:{p:Project}) {
  const file=fileById(p,p.entrypoints.app);const [selected,setSelected]=useState('');const source=fileById(p,selected)||file;if(!file)return null;
  return <><Card className="app-startup-card" title={t("启动与通信")}><Fields file={file} fields={app}/></Card>
    <Resources p={p} source={<Card title={t("工程文件")} extra={<Select aria-label={t("工程文件")} style={{width:320,maxWidth:'100%'}} value={source?.id} onChange={setSelected} options={p.files.filter(f=>/\.(ya?ml|urdf|xml|json)$/i.test(f.path)).map(f=>({value:f.id,label:f.path}))}/>}>
      {source&&<SourceEditor file={source}/>}</Card>}/></>;
}
