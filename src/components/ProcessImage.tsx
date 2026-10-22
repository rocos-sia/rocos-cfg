import { useState } from 'react';
import { Radio, Space, Table, Tag, type TableProps } from 'antd';
import type { BusSignal } from '../core/project/types';
import { t } from '../i18n';

export function ProcessImage({ signals }: { signals: BusSignal[] }) {
  const [grouped, setGrouped] = useState(false);
  const columns: TableProps<BusSignal>['columns'] = [
    { title: t('从站'), dataIndex: 'slaveId', width: 80 },
    { title: t('方向'), dataIndex: 'direction', width: 100, render: v => <Tag color={v === 'input' ? 'blue' : 'purple'}>{v === 'input' ? t('输入 Tx') : t('输出 Rx')}</Tag> },
    { title: t('运行时名称'), dataIndex: 'runtimeName' },
    { title: t('位宽'), dataIndex: 'bitLength', width: 70 },
    { title: t('位偏移'), dataIndex: 'bitOffset', width: 80, render: v => v ?? '—' },
    { title: t('原始名称'), dataIndex: 'sourceName' },
    { title: t('解析'), dataIndex: 'resolution', width: 100 },
  ];
  const table = (rows: BusSignal[]) => <Table size="small" scroll={{ x: 900 }} rowKey="uid" dataSource={rows} columns={columns} />;
  return <>
    <Space wrap className="section-tools">
      <span id="process-image-order">{t('排列方式')}</span>
      <Radio.Group aria-labelledby="process-image-order" value={grouped} onChange={e => setGrouped(e.target.value)} optionType="button" buttonStyle="solid"
        options={[{ value: false, label: t('原始顺序') }, { value: true, label: t('按 Rx / Tx 分组') }]} />
    </Space>
    {grouped ? (['output', 'input'] as const).map(direction => {
      const rows = signals.filter(signal => signal.direction === direction);
      return <section key={direction} aria-label={direction === 'output' ? t('输出 Rx') : t('输入 Tx')} className="space-top">
        <h3>{direction === 'output' ? t('输出 Rx') : t('输入 Tx')} <Tag>{rows.length}</Tag></h3>
        {table(rows)}
      </section>;
    }) : table(signals)}
  </>;
}
