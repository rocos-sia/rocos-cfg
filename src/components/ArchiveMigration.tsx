import { Alert, Button, Modal, Space } from 'antd';
import type { ArchiveInspection } from '../core/project/archive';
import type { MigrationReport } from '../core/project/migrations';
import type { OpenedFile } from '../adapters/file-access';
import { t } from '../i18n';

export interface PendingMigration {
  opened: OpenedFile;
  project: Extract<ArchiveInspection, {mode:'editable'}>['project'];
  report: MigrationReport;
}
export function ArchiveMigration({ pending, busy, onClose, onAccept, onCopy }: {
  pending?: PendingMigration; busy: boolean; onClose: () => void; onAccept: () => void; onCopy: () => void;
}) {
  return <Modal title={t('工程迁移预览')} open={!!pending} width={780} onCancel={()=>{if(!busy)onClose();}} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<Space><Button disabled={busy} onClick={onClose}>{t('取消')}</Button><Button disabled={busy} onClick={onCopy}>{t('复制原始工程包')}</Button><Button type="primary" disabled={busy} onClick={onAccept}>{t('打开迁移后的工程')}</Button></Space>}>
    {pending && <>
      <Alert type="info" showIcon message={t('迁移已在暂存区通过校验，当前工作区和原文件尚未改变。')}/>
      <p>{pending.project.name} · {t('工程模型 v{from} → v{to}',{from:pending.report.from,to:pending.report.to})}</p>
      <ol>{pending.report.steps.map(step=><li key={step.id}><strong>{step.id} · {step.from} → {step.to}</strong><p>{t(step.description)}</p>
        {step.manifestChanged && <p>{t('工程清单已更新')}</p>}
        {!!step.changedPaths.length && <ul>{step.changedPaths.map(path=><li key={path}>{path}</li>)}</ul>}
      </li>)}</ol>
      <p>{t('首次保存需要选择新文件；本会话将保护原工程路径，后续另存和副本导出也不能覆盖它。')}</p>
    </>}
  </Modal>;
}
