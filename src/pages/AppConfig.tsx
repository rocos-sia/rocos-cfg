import { t } from '../i18n';
import { Resources } from '../components/Resources';
import { Card, Select } from 'antd';
import { useState } from 'react';
import { type Project, fileById } from '../core/project/types';
import { robotConfigFile } from '../core/documents/app-config';
import { app } from '../core/documents/config-fields';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
export function AppConfig({p}:{p:Project}) {
  const file=fileById(p,p.entrypoints.app);const [selected,setSelected]=useState('');const source=fileById(p,selected)||file;if(!file)return null;const robot=robotConfigFile(p),composed=robot?.role==='app.robot';
  return <><Card className="app-startup-card" title={t("启动与通信")}><Fields file={file} fields={composed?app.filter(f=>!f.path.startsWith('robot.')).concat(['robot_config','device_config','user_config'].map(path=>({path,label:path}))):app}/></Card>
    {composed&&<Card title={t('机器人配置')}><Fields file={robot} fields={app.filter(f=>f.path.startsWith('robot.')&&!['robot.joint_binding','robot.payload'].includes(f.path)).map(f=>({...f,path:f.path.slice(6)})).concat([{path:'master_type',label:'master_type',type:'select',options:['ecm','igh','mujoco']},{path:'master_config',label:'master_config'}])}/></Card>}
    <Resources p={p} source={<Card title={t("工程文件")} extra={<Select aria-label={t("工程文件")} style={{width:320,maxWidth:'100%'}} value={source?.id} onChange={setSelected} options={p.files.filter(f=>/\.(ya?ml|urdf|xml|json)$/i.test(f.path)).map(f=>({value:f.id,label:f.path}))}/>}>
      {source&&<SourceEditor file={source}/>}</Card>}/></>;
}
