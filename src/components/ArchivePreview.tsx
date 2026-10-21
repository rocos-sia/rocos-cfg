import { useLocalizedMessage } from './useLocalizedMessage';
import { diagnosticText, errorText, t } from '../i18n';
import { Alert, Button, Modal, Table } from 'antd';
import type { ArchiveInspection } from '../core/project/archive';
import { download } from '../adapters/files';
export type ReadonlyArchive = Extract<ArchiveInspection, { mode: 'readonly' }> & { filename: string };
export function ArchivePreview({ archive, onClose }: { archive?: ReadonlyArchive; onClose: () => void }) {
  const message=useLocalizedMessage();
  return <Modal title={t("工程只读预览")} open={!!archive} width={780} styles={{body:{overflowWrap:'anywhere'}}} onCancel={onClose} footer={<Button onClick={() => archive && download(archive.original, archive.filename).catch(e=>message.error(()=>(errorText(e,true))))}>{t("复制原始工程包")}</Button>}>
    {archive && <><Alert type="warning" message={diagnosticText({message:archive.reason,text:archive.reasonText})} /><p>{t('{name} · 容器 v{format} / 工程 v{schema}',{name:diagnosticText({message:archive.summary.name,text:archive.summary.nameText}),format:archive.summary.formatVersion,schema:archive.summary.projectSchemaVersion})}</p>
      <p>{t("当前工作区未被替换。复制操作保留原包全部字节，不迁移、不重新打包。")}</p>
      <Table rowKey="path" size="small" dataSource={archive.summary.files} pagination={{ pageSize: 8 }} scroll={{x:500}} columns={[{ title: t("ZIP 条目"), dataIndex: 'path' }, { title: t("解压大小"), dataIndex: 'size', width:150, render: n => `${n.toLocaleString()} B` }]} />
    </>}
  </Modal>;
}
