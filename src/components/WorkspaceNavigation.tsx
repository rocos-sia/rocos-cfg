import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Menu } from 'antd';
import { t } from '../i18n';

const preferenceKey = 'rocos.sidebar.collapsed';
function initialPreference(): boolean | undefined {
  try { const value = localStorage.getItem(preferenceKey); return value === 'true' ? true : value === 'false' ? false : undefined; } catch { return undefined; }
}
export function WorkspaceNavigation({ items, route, hasProject, navigate }: {
  items: { key: string; label: string; icon: ReactNode }[]; route: string; hasProject: boolean; navigate: (key: string) => void;
}) {
  const [preference, setPreference] = useState(initialPreference);
  const [phone, setPhone] = useState(() => matchMedia('(max-width:599px)').matches);
  const [compact, setCompact] = useState(() => matchMedia('(max-width:1199px)').matches);
  const [open, setOpen] = useState(false);
  const aside = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const collapsed = phone ? !open : preference ?? compact;
  useLayoutEffect(() => {
    const mobile = matchMedia('(max-width:599px)'), narrow = matchMedia('(max-width:1199px)');
    const update = () => { setPhone(mobile.matches); setCompact(narrow.matches); if (!mobile.matches) setOpen(false); };
    mobile.addEventListener('change', update); narrow.addEventListener('change', update);
    return () => { mobile.removeEventListener('change', update); narrow.removeEventListener('change', update); };
  }, []);
  useLayoutEffect(() => {
    if (!phone || !open) return;
    const background: { element: HTMLElement; inert: boolean; hidden: string | null }[] = [];
    for (let element: HTMLElement | null = aside.current; element?.parentElement; element = element.parentElement) {
      for (const sibling of element.parentElement.children) if (sibling instanceof HTMLElement && sibling !== element && !sibling.hasAttribute('data-nav-backdrop')) {
        background.push({ element: sibling, inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
      }
      if (element.parentElement === document.body) break;
    }
    toggle.current?.focus({ preventScroll: true });
    return () => {
      for (const { element, inert, hidden } of background) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden);
      }
      requestAnimationFrame(() => toggle.current?.focus({ preventScroll: true }));
    };
  }, [phone, open]);
  const toggleNavigation = () => {
    if (phone) { setOpen(value => !value); return; }
    const value = !collapsed; setPreference(value);
    try { localStorage.setItem(preferenceKey, String(value)); } catch { /* Session state still works if storage is unavailable. */ }
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!phone || !open || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key !== 'Tab') return;
    const controls = [...aside.current!.querySelectorAll<HTMLElement>('button,[tabindex]')].filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1), focused = document.activeElement;
    if (event.shiftKey && first === focused) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && last && (last === focused || last.contains(focused))) { event.preventDefault(); first?.focus(); }
  };
  return <div className="sidebar-slot" data-collapsed={collapsed} data-phone={phone}>
    {phone && open && <div className="nav-backdrop" data-nav-backdrop onPointerDown={() => setOpen(false)} />}
    <aside className="sidebar" ref={aside} id="workspace-navigation" data-collapsed={collapsed} data-overlay={phone && open}
      role={phone && open ? 'dialog' : undefined} aria-modal={phone && open || undefined} aria-label={t('工程导航')} onKeyDown={keys}>
      <button ref={toggle} className="brand brand-toggle" type="button" aria-label={phone && open ? t('关闭导航') : collapsed ? t('展开导航') : t('收起导航')}
        title={collapsed ? t('展开导航') : t('收起导航')} aria-expanded={!collapsed} aria-controls="workspace-navigation-menu" onClick={toggleNavigation}>
        <span className="brand-symbol">R<span /></span><span className="brand-wordmark"><strong>ROCOS</strong><small>CONFIGURATOR</small></span>
      </button>
      <div className="nav-label">{t('工程工作台')}</div>
      <Menu id="workspace-navigation-menu" mode="inline" theme="dark" inlineCollapsed={collapsed} selectedKeys={[route]}
        items={items.map(item => { const label = t(item.label.replace(/^0[1-4]\s+/, '')); return { ...item, label, title: label, 'aria-label': label, disabled: !hasProject && item.key !== 'overview' }; })}
        onClick={({ key }) => { navigate(key); if (phone) setOpen(false); }} />
      <div className="sidebar-bottom"><div className="status-dot" />{t('离线配置工具')}<small>{__APP_VERSION__}</small></div>
    </aside>
  </div>;
}
