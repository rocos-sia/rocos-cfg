import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { t } from '../i18n';

/** One set of controls: resizing or opening the popover never remounts them. */
export function WorkspaceActions({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(() => matchMedia('(max-width:899px)').matches), [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const query = matchMedia('(max-width:899px)');
    const update = () => {
      const focused = document.activeElement;
      if (query.matches && focused && content.current?.contains(focused)) setOpen(true);
      if (!query.matches) {
        setOpen(false);
        if (focused === button.current) requestAnimationFrame(() => content.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true }));
      }
      setCompact(query.matches);
    };
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    if (!compact || !open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!root.current?.contains(target) && !target.closest('.ant-dropdown,[role=dialog]')) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || (event.target as Element)?.closest('[role=dialog],.ant-dropdown')) return;
      event.preventDefault(); setOpen(false); button.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [compact, open]);
  return <div className="workspace-actions" ref={root} data-compact={compact}>
    <Button ref={button} className="workspace-actions-toggle" hidden={!compact} icon={<MoreOutlined aria-hidden />} aria-label={t('更多操作')}
      aria-expanded={open} aria-controls="workspace-secondary-actions" onClick={() => setOpen(value => !value)} />
    <div className="workspace-secondary-actions" id="workspace-secondary-actions" ref={content} role="group" aria-label={t('更多操作')} hidden={compact && !open}>{children}</div>
  </div>;
}
