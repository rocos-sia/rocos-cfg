import { t } from '../i18n';
import { Alert, App, Button, Modal, Table } from 'antd';
import type { ArchiveInspection } from '../core/project/archive';
import { download } from '../adapters/files';
export type ReadonlyArchive = Extract<ArchiveInspection, { mode: 'readonly' }> & { filename: string };
export function ArchivePreview({ archive, onClose }: { archive?: ReadonlyArchive; onClose: () => void }) {
  const {message}=App.useApp();
  return <Modal title={t("工程只读预览")} open={!!archive} width={780} onCancel={onClose} footer={<Button onClick={() => archive && download(archive.original, archive.filename).catch(e=>message.error(String(e)))}>{t("复制原始工程包")}</Button>}>
    {archive && <><Alert type="warning" message={archive.reason} /><p>{t('{name} · 容器 v{format} / 工程 v{schema}',{name:archive.summary.name,format:archive.summary.formatVersion,schema:archive.summary.projectSchemaVersion})}</p>
      <p>{t("当前工作区未被替换。复制操作保留原包全部字节，不迁移、不重新打包。")}</p>
      <Table rowKey="path" size="small" dataSource={archive.summary.files} pagination={{ pageSize: 8 }} columns={[{ title: t("ZIP 条目"), dataIndex: 'path' }, { title: t("解压大小"), dataIndex: 'size', render: n => `${n.toLocaleString()} B` }]} />
    </>}
  </Modal>;
}
