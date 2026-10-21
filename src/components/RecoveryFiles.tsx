import { useLocalizedMessage } from './useLocalizedMessage';
import { errorText, t, getLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Popconfirm, Space, Table } from 'antd';
import { listRecovery, readRecovery, type RecoverySummary } from '../adapters/recovery';
import { discardRecovery, useProject } from '../store';
import type { Project } from '../core/project/types';

export function RecoveryFiles({replace,disabled}:{replace:(p:Project)=>Promise<void>;disabled:boolean}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[rows,setRows]=useState<RecoverySummary[]>([]);
  const active=useProject(s=>s.recoveryKey),message=useLocalizedMessage();
  useEffect(()=>{
    let mounted=true;
    void listRecovery().then(found=>{if(mounted&&found.length&&!useProject.getState().project){setRows(found);setOpen(true);}}).catch(()=>{});
    return()=>{mounted=false;};
  },[]);
  const refresh=async()=>{setBusy(true);try{setRows(await listRecovery());setOpen(true);}catch(e){message.error(()=>(t('无法读取本机草稿：{error}',{error:errorText(e,true)})));}finally{setBusy(false);}};
  const restore=async(row:RecoverySummary)=>{
    setBusy(true);try{const p=await readRecovery(row.key);await replace(p);setOpen(false);}catch(e){message.error(()=>(t('草稿恢复失败，已保留缓存：{error}',{error:errorText(e,true)})));}finally{setBusy(false);}
  };
  const remove=async(row:RecoverySummary)=>{
    setBusy(true);try{await discardRecovery(row.key);setRows(await listRecovery());}catch(e){message.error(()=>(errorText(e,true)));}finally{setBusy(false);}
  };
  return <><Button disabled={disabled||busy} onClick={()=>void refresh()}>{t("本机恢复草稿")}</Button>
    <Modal title={t("本机恢复草稿")} open={open} width={900} onCancel={()=>{if(!busy)setOpen(false);}} footer={<Button disabled={busy} onClick={()=>setOpen(false)}>{t("暂不恢复")}</Button>}>
      <Alert type="info" showIcon message={t("每次打开工程分别保留草稿，相同工程的不同副本不会互相覆盖。缓存只在本机可用，不能代替 .rcproj 文件。")}/>
      <Table<RecoverySummary> rowKey="key" loading={busy} dataSource={rows} pagination={{pageSize:5}} scroll={{x:720}} locale={{emptyText:t("暂无可恢复草稿")}} columns={[
        {title:t("工程"),dataIndex:'name',render:(name,row)=><><strong>{name}</strong><div>revision {row.revision} · {t('{count} 个文件',{count:row.fileCount})}</div><details><summary>{t("标识")}</summary><small style={{overflowWrap:'anywhere'}}>{t("工程：")}{row.projectId}<br/>{t("快照：")}{row.snapshotId}</small></details></>},
        {title:t("缓存时间"),dataIndex:'cachedAt',render:value=>new Date(value).toLocaleString(getLocale())},
        {title:t("操作"),render:(_,row)=><Space><Button disabled={busy||disabled||row.key===active} onClick={()=>void restore(row)}>{t("恢复草稿")}</Button><Popconfirm title={t("清除此本机草稿？")} description={t("工程文件不受影响，清除后无法从此缓存恢复。")} okText={t("确认清除")} cancelText={t("取消")} onConfirm={()=>remove(row)}><Button danger disabled={busy||row.key===active}>{t("清除草稿")}</Button></Popconfirm></Space>},
      ]}/>
      <p className="muted">{t("恢复会创建新的编辑会话；原缓存保留，可在确认工程文件已留存后清除。当前会话的缓存不可清除。")}</p>
    </Modal>
  </>;
}
