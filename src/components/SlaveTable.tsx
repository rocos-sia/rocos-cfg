import { useRef, useState } from 'react';
import { Button, Modal, Space, Table, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import type { BusSlave, Project } from '../core/project/types';
import { planSlaveChange, type SlaveAction, type SlavePlan } from '../core/bus/igh-edit';
import { useProject } from '../store';
import { diagnosticText, errorText, t } from '../i18n';
import { useLocalizedMessage } from './useLocalizedMessage';

export function SlaveTable({ p, slaves }: { p: Project; slaves: BusSlave[] }) {
  const message = useLocalizedMessage(), editable = p.entrypoints.master.kind === 'igh';
  const [pending, setPending] = useState<{ plan: SlavePlan; epoch: number; revision: number }>();
  const drag = useRef<{ index: number; epoch: number; revision: number } | undefined>(undefined);
  const [over, setOver] = useState<number>();
  const stage = (action: SlaveAction) => {
    try { setPending({ plan: planSlaveChange(p, action), epoch: useProject.getState().workspaceEpoch, revision: p.revision }); }
    catch (error) { message.error(() => errorText(error, true)); }
  };
  const iconButton = (label: string, icon: React.ReactNode, action: SlaveAction, disabled = false, danger = false) =>
    <Tooltip title={label}><Button size="small" type="text" aria-label={label} icon={icon} disabled={disabled} danger={danger} onClick={() => stage(action)} /></Tooltip>;
  return <>
    {editable && <p className="muted slave-order-help">{t('按住从站行拖动排序，也可使用上移/下移按钮；应用前可查看绑定变化。')}</p>}
    <Table className="slave-table" size="small" scroll={{ x: editable ? 780 : 650 }} rowKey="id" dataSource={slaves} pagination={false}
      onRow={(_, index) => editable ? {
        draggable: true,
        className: over === index ? 'slave-drop-target' : undefined,
        onDragStart: event => {
          drag.current = { index: index!, epoch: useProject.getState().workspaceEpoch, revision: p.revision };
          event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index));
        },
        onDragOver: event => { if (drag.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(index); } },
        onDragEnd: () => { drag.current = undefined; setOver(undefined); },
        onDrop: event => {
          event.preventDefault(); const from = drag.current; drag.current = undefined; setOver(undefined);
          if (!from || from.index === index) return;
          if (from.epoch !== useProject.getState().workspaceEpoch || from.revision !== p.revision) { message.error(() => t('工程已变化，请重新查看影响后操作')); return; }
          stage({ kind: 'move', index: from.index, target: index! });
        },
      } : {}}
      columns={[
        { title: t('运行时 ID'), dataIndex: 'id', render: id => <span>{editable && <HolderOutlined className="slave-drag-handle" aria-hidden />} {id}</span> },
        { title: t('名称'), dataIndex: 'name' }, { title: t('固定地址'), dataIndex: 'address', render: v => v ?? '—' },
        { title: 'Vendor', dataIndex: 'vendor', render: v => v || '—' }, { title: 'Product', dataIndex: 'product', render: v => v || '—' },
        ...(editable ? [{ title: t('操作'), width: 116, render: (_: unknown, slave: BusSlave, index: number) => <Space size={2}>
          {iconButton(t('上移从站 {id}', { id: slave.id }), <ArrowUpOutlined />, { kind: 'up', index }, index === 0)}
          {iconButton(t('下移从站 {id}', { id: slave.id }), <ArrowDownOutlined />, { kind: 'down', index }, index === slaves.length - 1)}
          {iconButton(t('删除从站 {id}', { id: slave.id }), <DeleteOutlined />, { kind: 'delete', index }, false, true)}
        </Space> }] : []),
      ]} />
    <Modal title={t('确认从站及绑定变更')} open={!!pending} width={620} okText={t('应用变更')} cancelText={t('取消')} onCancel={() => setPending(undefined)} onOk={() => {
      if (!pending) return;
      const state = useProject.getState();
      if (state.workspaceEpoch !== pending.epoch || state.project?.id !== p.id || state.project.revision !== pending.revision) { message.error(() => t('工程已变化，请重新查看影响后操作')); return; }
      state.change(next => Object.assign(next, pending.plan.project)); setPending(undefined);
    }}><ul>{pending?.plan.impactMessages.map((issue, i) => <li key={i}>{diagnosticText(issue)}</li>)}</ul></Modal>
  </>;
}
