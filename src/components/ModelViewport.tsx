import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { t } from '../i18n';

/** Keep controls in place; desktop WebKit and browsers share the same overlay. */
export function ModelViewport({ children, onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void; children: (controls: {
  expanded: boolean; toggle: () => void; buttonRef: RefObject<HTMLButtonElement | null>;
}) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const isExpanded = useRef(expanded); isExpanded.current = expanded;
  useLayoutEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const background: { node: HTMLElement; inert: boolean; hidden: string | null }[] = [];
    for (let node: HTMLElement | null = frame.current; node?.parentElement; node = node.parentElement) {
      const parent = node.parentElement;
      for (const sibling of parent.children) if (sibling instanceof HTMLElement && sibling !== node) {
        background.push({ node: sibling, inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
      }
      if (parent === document.body) break;
    }
    button.current?.focus();
    return () => {
      for (const { node, inert, hidden } of background) {
        node.inert = inert;
        if (hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden);
      }
      requestAnimationFrame(() => { if (!isExpanded.current) button.current?.focus({ preventScroll: true }); });
    };
  }, [expanded]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expanded || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); return; }
    if (event.key !== 'Tab') return;
    const controls = [...frame.current!.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className={`model-viewport${expanded ? ' is-expanded' : ''}`}>
    <div ref={frame} className={expanded ? 'model-viewport-expanded' : 'model-viewport-inline'}
      role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label={expanded ? t('模型展开视图') : t('模型预览')} onKeyDown={keys}>
      <div className="model-viewport-content">{children({ expanded, toggle: () => setExpanded(value => !value), buttonRef: button })}</div>
    </div>
  </div>;
}
