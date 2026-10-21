import { t } from '../i18n';
import { Modules } from '../components/Modules';
import { Resources } from '../components/Resources';
import { Card, Select, Space } from 'antd';
import { useState } from 'react';
import { type Project, fileById } from '../core/project/types';
import { Fields } from '../components/Fields';
import { SourceEditor } from '../components/SourceEditor';
export function AppConfig({p}:{p:Project}) {
  const file=fileById(p,p.entrypoints.app);const [selected,setSelected]=useState('');const source=fileById(p,selected)||file;if(!file)return null;
  return <><div className="page-heading"><div><h1>{t("APP 配置")}</h1><p>{t("配置启动参数与资源路径；路径相对于 APP config.yaml。")}</p></div></div><Card title={t("启动与通信")}><Fields file={file} fields={[{path:'http_host',label:t("HTTP 监听地址")},{path:'http_port',label:t("HTTP 端口"),type:'number',min:1,max:65535},{path:'http_control_ttl_seconds',label:t("控制权 TTL"),type:'number',unit:'s',min:1},{path:'robot.ecat_id',label:t("EtherCAT 主站 ID"),type:'number',min:0},...['hardware_config','urdf','base_link','tip_link','joint_binding','payload'].map(k=>({path:`robot.${k}`,label:k})),{path:'scripts',label:t("Lua 脚本目录")},{path:'web_root',label:t("HMI 静态资源目录")}]}/></Card><Card className="space-top" title={t("工程文件")} extra={<Select style={{width:320}} value={source?.id} onChange={setSelected} options={p.files.filter(f=>/\.(ya?ml|urdf|xml|json)$/i.test(f.path)).map(f=>({value:f.id,label:f.path}))}/>}><Space/>{source&&<SourceEditor file={source}/>}</Card><Modules p={p}/><Resources p={p}/></>;
}
