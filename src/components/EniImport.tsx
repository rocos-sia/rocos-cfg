import { useState } from 'react';
import { Button, Modal } from 'antd';
import { fileAccess } from '../adapters/file-access';
import { planEniImport } from '../core/bus/eni-import';
import { LIMITS } from '../core/project/zip';
import type { Project } from '../core/project/types';
import { flushBuffers, useProject } from '../store';
import { errorText, t } from '../i18n';
import { useLocalizedMessage } from './useLocalizedMessage';

type Pending={project:Project;revision:number;epoch:number};
export function EniImport() {
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending>();
  const message=useLocalizedMessage();
  const apply=(plan:Pending)=>{
    const state=useProject.getState();
    if(state.workspaceEpoch!==plan.epoch||state.project?.id!==plan.project.id||state.project.revision!==plan.revision)throw new Error('导入期间工程已变化，请重新选择文件');
    state.change(n=>Object.assign(n,plan.project));setPending(undefined);
    message.success(()=>t('已更新 IGH 和 ECM 配置；可撤销本次导入'));
  };
  const select=async()=>{
    const epoch=useProject.getState().workspaceEpoch;setBusy(true);
    try{
      const files=await fileAccess().import(false);if(!files?.length)return;
      if(files.length!==1)throw new Error('请只选择一个 ENI 文件');
      if(files[0].size>LIMITS.file)throw new Error('ENI 文件超过大小限制');
      const bytes=new Uint8Array(await files[0].arrayBuffer());await flushBuffers();
      const state=useProject.getState();if(state.workspaceEpoch!==epoch||!state.project)throw new Error('导入期间工程已变化，请重新选择文件');
      const plan=planEniImport(state.project,bytes),value={project:plan.project,revision:state.project.revision,epoch};
      if(plan.overwrite)setPending(value);else apply(value);
    }catch(e){message.error(()=>errorText(e,true));}finally{setBusy(false);}
  };
  return <><Button loading={busy} disabled={!!pending} onClick={()=>void select()}>{t('导入 ENI')}</Button>
    <Modal title={t('覆盖已有 IGH 配置？')} open={!!pending} okText={t('覆盖并导入')} cancelText={t('取消')} onCancel={()=>setPending(undefined)} onOk={()=>{try{if(pending)apply(pending);}catch(e){message.error(()=>errorText(e,true));setPending(undefined);}}}>
      <p>{t('将用 ENI 中的 PDO 配置覆盖现有 IGH 从站配置及其源码草稿，并更新 ECM 的 ENI 和公共周期。已有硬件映射保留，导入后请重新核对。')}</p>
    </Modal></>;
}
