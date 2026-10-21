import { useLocalizedMessage } from './useLocalizedMessage';
import { m as msg, MessageError } from '../core/project/messages';
import { useLocalizedModal } from './useLocalizedModal';
import { errorText, diagnosticText, t } from '../i18n';
import { useState } from 'react';
import { Alert, Button, Card, Modal, Space, Table, Tag } from 'antd';
import { attachProfile, baseTarget, profileDefinition, targetStatus } from '../core/project/profiles';
import { validateTemplates } from '../core/project/templates';
import { fileById, textOf, type Project, type ProjectFile } from '../core/project/types';
import { useProject } from '../store';
export function Provenance({p}:{p:Project}){
  const [selected,setSelected]=useState<ProjectFile>();const message=useLocalizedMessage();const modal=useLocalizedModal();
  const rows=(['master','app'] as const).map(slot=>({slot,label:slot==='master'?t("主站"):'APP',...targetStatus(p,slot)}));
  const adopt=(slot:'app'|'master')=>{
    const definition=profileDefinition(slot==='app'?'app':p.entrypoints.master.kind),epoch=useProject.getState().workspaceEpoch;
    modal.confirm(()=>({title:t("确认目标规则"),content:<><p>{t('当前目标：{target}。将使用内置 {id} v{version}（{baseline}）并保存规则快照。',{target:p.targets[slot].version,id:definition.id,version:definition.version,baseline:definition.target.version})}</p><p>{t("配置原文和已有快照保留；这不证明原文件来自该版本。机械参数与绑定需重新确认，再重新校验。")}</p></>,okText:t("使用此规则"),onOk:()=>{
      try{if(useProject.getState().workspaceEpoch!==epoch||useProject.getState().project?.revision!==p.revision)throw new MessageError(msg("工程已变化，请重新确认目标规则"));
        useProject.getState().change(next=>{const status=targetStatus(next,slot);if(status.supported&&status.legacy)attachProfile(next,slot);else{next.targets[slot]=baseTarget(slot==='app'?'app':next.entrypoints.master.kind);attachProfile(next,slot,true);}next.editor.confirmations={};});
      }catch(e){message.error(()=>(errorText(e,true)));}
    }}));
  };
  const show=(id?:string)=>{const file=fileById(p,id);if(file&&file.bytes.length>1024*1024)message.warning(()=>(t("快照超过预览限额，可在导出页下载原文查看")));else if(file)setSelected(file);else message.warning(()=>(t("快照文件不存在")));};
  const issues=validateTemplates(p);
  return <Card title={t("目标规则与模板来源")} className="space-top">
    <Table size="small" rowKey="slot" pagination={false} dataSource={rows} columns={[
      {title:t("目标"),dataIndex:'label'},{title:t("状态"),render:(_,row)=><><Tag color={!row.supported?'red':row.legacy?'orange':'green'}>{!row.supported?t("不受支持"):row.legacy?t("未留存快照"):t("快照已核对")}</Tag>{diagnosticText(row)}</>},
      {title:t("操作"),render:(_,row)=><Space>{p.targets[row.slot].profile&&<Button onClick={()=>show(p.targets[row.slot].profile?.fileId)}>{t("查看规则快照")}</Button>}{(!row.supported||row.legacy)&&<Button onClick={()=>adopt(row.slot)}>{row.legacy?t("补存当前规则"):t("改用内置规则")}</Button>}</Space>},
    ]}/>
    <p>{t("规则快照用于核对目标版本，ABI、SDK 和设备配对仍需验证。归档中的数据不会被作为插件代码执行。")}</p>
    <Table size="small" rowKey="id" dataSource={Array.isArray(p.editor.templateUses)?p.editor.templateUses:[]} pagination={{pageSize:4}} locale={{emptyText:t("此工程没有模板使用记录，当前文件保持原样")}} columns={[
      {title:t("已使用模板"),render:(_,use)=>`${use.templateId} v${use.version}`},
      {title:t("应用时参数"),render:(_,use)=><><div>{JSON.stringify(use.parameters)}</div><small>{t("覆盖默认值：")}{Object.keys(use.overrides).length?JSON.stringify(use.overrides):t("无")}</small></>},
      {title:t("查看"),render:(_,use)=><Button onClick={()=>show(use.snapshotFileId)}>{t("查看模板快照")}</Button>},
    ]}/>
    <p className="muted">{t("记录保留模板建议与应用时覆盖值。后续编辑以配置文档为准；重新打开工程不会重新套用模板。")}</p>
    {issues.map((d,i)=><Alert key={i} type={d.severity==='error'?'error':'warning'} message={diagnosticText(d)}/>)}
    <Modal title={t("规则与模板快照 · 只读")} open={!!selected} width={850} onCancel={()=>setSelected(undefined)} footer={<Button onClick={()=>setSelected(undefined)}>{t("关闭预览")}</Button>}>
      <p>{selected?.path}</p><pre style={{maxHeight:'60vh',overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{selected&&(()=>{try{return textOf(selected);}catch{return t("此文件无法按声明的编码显示");}})()}</pre>
    </Modal>
  </Card>;
}
