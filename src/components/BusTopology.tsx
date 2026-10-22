import { useMemo } from 'react';
import { Card, Tag } from 'antd';
import { Background, Controls, Position, ReactFlow, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BusCatalog } from '../core/project/types';
import { t } from '../i18n';

export default function BusTopology({ catalog, kind, dark }: { catalog: BusCatalog; kind: 'igh' | 'ecm'; dark: boolean }) {
  const master = kind === 'igh' ? 'IgH' : 'EC-Master';
  const nodes: Node[] = useMemo(() => [
    { id: 'master', type: 'input', position: { x: 0, y: 0 }, sourcePosition: Position.Right, data: { label: `${master} · ${catalog.masterId ?? '—'}` }, ariaLabel: `${master} · ${catalog.masterId ?? '—'}` },
    ...catalog.slaves.map((slave, index) => ({ id: `slave-${index}`, position: { x: (index + 1) * 220, y: 0 }, sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: <><strong>Slave {slave.id}</strong><span>{slave.name}</span>{slave.address !== undefined && <small>#{slave.address}</small>}</> }, ariaLabel: `Slave ${slave.id} · ${slave.name}` })),
  ], [catalog.slaves, catalog.masterId, master]);
  const edges: Edge[] = catalog.slaves.map((_, index) => ({ id: `link-${index}`, source: index ? `slave-${index - 1}` : 'master', target: `slave-${index}`, type: 'straight' }));
  return <Card className="space-top bus-topology-card" title={t('EtherCAT 主站拓扑')} extra={<Tag>{t('从站 ({count})', { count: catalog.slaves.length })}</Tag>}>
    <p className="muted">{kind === 'igh' ? t('按 IgH 配置顺序连接，排序或删除从站后自动更新。') : t('按 ENI 从站顺序展示，只读；此顺序视图不推断物理端口分支。')}</p>
    <div className="bus-topology" aria-label={t('EtherCAT 配置顺序拓扑')}>
      <ReactFlow key={catalog.slaves.length} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: .25, maxZoom: 1 }} minZoom={.05} maxZoom={1.5}
        ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': t('放大拓扑'), 'controls.zoomOut.ariaLabel': t('缩小拓扑'), 'controls.fitView.ariaLabel': t('适应拓扑') }}
        colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={false} deleteKeyCode={null} preventScrolling={false}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
  </Card>;
}
