import { ExportOutlined, GlobalOutlined, RobotOutlined } from '@ant-design/icons';
import { t } from '../i18n';

const links = [
  { name: 'Robot Viewer', href: 'https://viewer.robotsfan.com/', description: 'URDF 与 MJCF 快速预览', icon: RobotOutlined },
  { name: 'IgH EtherCAT Master', href: 'https://etherlab.org/en_GB/ethercat', description: '官方网站', icon: GlobalOutlined },
  { name: 'EC-Master', href: 'https://www.acontis.com/en/ethercat-master.html', description: '官方网站', icon: GlobalOutlined },
];

export function QuickNavigation() {
  return <nav className="quick-navigation" aria-labelledby="quick-navigation-title">
    <h2 id="quick-navigation-title">{t('快速导航')}</h2>
    <div className="quick-navigation-grid">
      {links.map(link => <a className="quick-navigation-card" key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
        <link.icon className="quick-navigation-icon" aria-hidden />
        <span className="quick-navigation-content">
          <strong>{link.name}</strong>
          <span>{t(link.description)}</span>
          <small>{t('在新标签页打开')} <ExportOutlined aria-hidden /></small>
        </span>
      </a>)}
    </div>
  </nav>;
}
