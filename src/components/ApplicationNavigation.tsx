import type { ReactNode } from 'react';
import { Tabs } from 'antd';
import { t } from '../i18n';

const sections = [
  { key: 'startup', label: '启动参数', title: 'APP 配置', description: '配置启动参数与资源路径；路径相对于 APP config.yaml。' },
  { key: 'robot', label: '模型', title: '机器人模型', description: '编辑结构与属性，预览模型；预览不会驱动真实设备。' },
  { key: 'hardware', label: '硬件', title: '硬件与绑定', description: '按控制关节选择实际从站，确认机械换算与过程数据。' },
  { key: 'binding', label: '绑定', title: '硬件与绑定', description: '按控制关节选择实际从站，确认机械换算与过程数据。' },
  { key: 'payload', label: '负载', title: '负载', description: '' },
];

export function ApplicationNavigation({ activeKey, onChange, children, actions }: {
  activeKey: string; onChange: (key: string) => void; children: ReactNode; actions?: ReactNode;
}) {
  const section=sections.find(item=>item.key===activeKey)??sections[0];
  return <><div className="page-heading application-page-heading"><div><h1>{t(section.title)}</h1>{section.description&&<p>{t(section.description)}</p>}</div>{actions}</div><Tabs className="application-tabs configuration-tabs" activeKey={activeKey} onChange={onChange}
    items={sections.map(section => ({ key: section.key, label: t(section.label),
      children: section.key === activeKey ? children : null,
    }))} /></>;
}
