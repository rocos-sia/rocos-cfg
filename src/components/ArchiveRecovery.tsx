import { messageFields, type MessageInput } from '../core/project/messages';
import { diagnosticText, t } from '../i18n';
import { Alert, Button, Modal, Space, Table, Tag } from 'antd';
import type { OpenedFile } from '../adapters/file-access';
import type { ProjectRecovery } from '../core/project/recover';
export interface FailedArchive { opened:OpenedFile; error:MessageInput; recovery?:ProjectRecovery; recoveryError?:MessageInput }
export function ArchiveRecovery({archive,busy,onClose,onInspect,onRecover,onCopy}:{
  archive?:FailedArchive;busy:boolean;onClose:()=>void;onInspect:()=>void;onRecover:()=>void;onCopy:()=>void;
}){
  return <Modal title={t("工程完整性检查失败")} open={!!archive} width={900} styles={{body:{overflowWrap:'anywhere'}}} closable={!busy} onCancel={()=>{if(!busy)onClose();}} footer={<Space wrap>
    <Button disabled={busy} onClick={onClose}>{t("保留当前工作区")}</Button><Button disabled={busy} onClick={onCopy}>{t("复制原始工程包")}</Button>
    {!archive?.recovery&&<Button disabled={busy} onClick={onInspect}>{t("检查可恢复文件")}</Button>}
    {archive?.recovery&&<Button type="primary" disabled={busy} onClick={onRecover}>{t("创建恢复工程")}</Button>}
  </Space>}>
    {archive&&<><Alert type="error" message={diagnosticText(messageFields(archive.error))}/><p>{archive.opened.name}{t("：原包与当前工作区保持不变。可检查并提取通过 CRC、长度和 SHA-256 校验的文件。哈希校验不证明文件作者身份。")}</p>
      {archive.recoveryError&&<Alert type="warning" message={t('无法安全恢复：{error}',{error:diagnosticText(messageFields(archive.recoveryError))})} description={t("请保留原包，使用备份或适配该格式的版本处理。")}/>}
      {archive.recovery&&<><p>{t("来源：")}{archive.recovery.source.name}{t("。恢复为新的工程 UUID，包含恢复报告和原 manifest；损坏、缺失和未登记的文件不会进入新工程。")}</p>
        <Table rowKey="path" size="small" dataSource={archive.recovery.records} pagination={{pageSize:6}} scroll={{x:650}} columns={[
          {title:t("文件"),dataIndex:'path'},{title:t("状态"),dataIndex:'status',render:s=><Tag color={s==='verified'?'green':'orange'}>{{verified:t("可恢复"),missing:t("缺失"),damaged:t("损坏"),unlisted:t("未登记")}[s as 'verified']}</Tag>},
          {title:t("检查结果"),dataIndex:'message',render:(_,record)=>diagnosticText(record)},
        ]}/>
        <ul>{archive.recovery.notes.map((note,i)=><li key={i}>{diagnosticText(archive.recovery!.noteMessages?.[i]||{message:note})}</li>)}</ul>
        <p>{t("创建后需重新校验并保存到新文件；不会自动覆盖原工程。")}</p>
      </>}
    </>}
  </Modal>;
}
