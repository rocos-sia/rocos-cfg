import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Space } from 'antd';
import { t } from '../i18n';
import { ParameterHelp } from './ParameterHelp';
import { createModelLayoutState, layoutMode, modelLayout, panelGap, type ModelLayoutState, type ModelPanel } from './modelLayout';

/** Keep all three panes mounted while changing their grid tracks/visibility. */
export function ModelWorkspace({ state, onShowTree, actions, controls, children }: {
  state: ModelLayoutState; onShowTree: () => void; actions?: ReactNode; controls?: ReactNode;
  children: (onPreviewExpanded: (expanded: boolean) => void) => [ReactNode, ReactNode, ReactNode];
}) {
  const root = useRef<HTMLDivElement>(null), reset = useRef<HTMLButtonElement>(null), id = useId();
  state.scroll ||= { properties: 0, preview: 0 };
  const [width, setWidth] = useState(0), [height, setHeight] = useState(360), [preferences, setPreferences] = useState(() => ({ ...state }));
  const [expanded, setExpanded] = useState(false), [resizing, setResizing] = useState(false);
  const modeRef = useRef(layoutMode(0)), pendingFocus = useRef(false);
  const measureNow = useRef<() => void>(() => {});
  const tabs = useRef<Partial<Record<ModelPanel, HTMLButtonElement | null>>>({});
  const drag = useRef<{ pointer: number; x: number; value: number; kind: 'tree' | 'properties'; before: number } | undefined>(undefined);
  const update = useCallback((patch: Partial<ModelLayoutState>) => {
    setPreferences(previous => { const next = { ...previous, ...patch }; Object.assign(state, next); return next; });
  }, [state]);
  const previewExpanded = useCallback((value: boolean) => { setExpanded(value); if (value) update({ active: 'preview' }); }, [update]);
  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width), nextMode = layoutMode(nextWidth);
      if (modeRef.current !== nextMode) {
        const focused = document.activeElement;
        const panel = focused instanceof Element ? focused.closest<HTMLElement>('[data-model-panel]') : null;
        if (panel && element.contains(panel)) {
          update({ active: panel.dataset.modelPanel as ModelPanel, ...(nextMode === 'wide' && panel.dataset.modelPanel === 'properties' ? { propertiesCollapsed: false } : {}) });
        } else if (focused instanceof Element && element.contains(focused)) pendingFocus.current = true;
      }
      modeRef.current = nextMode; setWidth(nextWidth);
      const owner = element.closest<HTMLElement>('.workspace'), grid = element.querySelector<HTMLElement>('.robot-workspace');
      if (owner && grid) {
        // Cancel the owner's scroll offset: scrolling to source must not grow
        // the panes and push the source farther away.
        const top = grid.getBoundingClientRect().top - owner.getBoundingClientRect().top + owner.scrollTop;
        const available = owner.clientHeight - top - parseFloat(getComputedStyle(owner).paddingBottom || '0');
        setHeight(Math.max(360, Math.min(680, Math.floor(available))));
      }
    };
    measureNow.current = measure; measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    const owner = element.closest('.workspace'); if (owner) observer.observe(owner);
    return () => { observer.disconnect(); measureNow.current = () => {}; };
  }, [update]);
  useLayoutEffect(() => { measureNow.current(); });
  const layout = modelLayout(width, preferences), active = expanded ? 'preview' : preferences.active;
  const visible = (panel: ModelPanel) => layout.mode === 'wide' ? panel !== 'properties' || !layout.collapsed : layout.mode === 'dual' ? panel === 'tree' || panel === (active === 'tree' ? 'preview' : active) : panel === active;
  const treeVisible = visible('tree');
  const showTree = useRef(onShowTree), wasTreeVisible = useRef(true); showTree.current = onShowTree;
  useLayoutEffect(() => {
    // Width zero is the unmeasured mount, not a real hidden-to-visible change.
    // Revealing here would clear a retained filter that excludes selection.
    if (!width) return;
    if (treeVisible && !wasTreeVisible.current) showTree.current();
    wasTreeVisible.current = treeVisible;
  }, [treeVisible, width]);
  const scrollSelectors = { properties: '.model-pane-properties>.ant-card>.ant-card-body', preview: '.model-viewport-inline .model-viewport-content' };
  const wasVisible = useRef({ properties: false, preview: false });
  useLayoutEffect(() => {
    for (const panel of ['properties', 'preview'] as const) {
      const shown = width > 0 && visible(panel) && !(panel === 'preview' && expanded);
      const element = root.current?.querySelector<HTMLElement>(scrollSelectors[panel]);
      if (shown && !wasVisible.current[panel] && element) element.scrollTop = state.scroll[panel];
      wasVisible.current[panel] = shown;
    }
  });
  useLayoutEffect(() => () => {
    for (const panel of ['properties', 'preview'] as const) {
      const element = root.current?.querySelector<HTMLElement>(scrollSelectors[panel]);
      if (element?.getClientRects().length) state.scroll[panel] = element.scrollTop;
    }
  }, [state]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return; pendingFocus.current = false;
    (layout.mode === 'wide' ? reset.current : tabs.current[active === 'tree' && layout.mode === 'dual' ? 'preview' : active])?.focus({ preventScroll: true });
  }, [layout.mode, active]);
  const [tree, preview, properties] = children(previewExpanded);
  const panels: ModelPanel[] = layout.mode === 'single' ? ['tree', 'preview', 'properties'] : ['preview', 'properties'];
  const label = (panel: ModelPanel) => panel === 'tree' ? t('结构') : panel === 'preview' ? t('预览') : t('属性');
  const panelId = (panel: ModelPanel) => `${id}-panel-${panel}`, tabId = (panel: ModelPanel) => `${id}-tab-${panel}`;
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, panel: ModelPanel) => {
    let index = panels.indexOf(panel);
    if (event.key === 'ArrowRight') index = (index + 1) % panels.length;
    else if (event.key === 'ArrowLeft') index = (index + panels.length - 1) % panels.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = panels.length - 1;
    else return;
    event.preventDefault(); update({ active: panels[index] }); tabs.current[panels[index]]?.focus();
  };
  const size = (kind: 'tree' | 'properties', value: number) => update(kind === 'tree' ? { treeWidth: Math.max(240, Math.min(layout.treeMax, value)) } : { propertiesWidth: Math.max(320, Math.min(layout.propertiesMax, value)) });
  const separator = (kind: 'tree' | 'properties') => {
    const hidden = layout.mode === 'single' || kind === 'properties' && (layout.mode !== 'wide' || layout.collapsed);
    const value = kind === 'tree' ? layout.tree : layout.properties, min = kind === 'tree' ? 240 : 320, max = kind === 'tree' ? layout.treeMax : layout.propertiesMax;
    return <div className={`model-resizer model-resizer-${kind}`} role="separator" tabIndex={hidden ? -1 : 0} hidden={hidden} aria-orientation="vertical"
      aria-label={kind === 'tree' ? t('调整结构面板宽度') : t('调整属性面板宽度')} aria-controls={panelId(kind)} aria-describedby={`${id}-help`}
      aria-valuemin={min} aria-valuemax={Math.round(Math.max(min, max))} aria-valuenow={Math.round(value)} aria-valuetext={t('{size} px', { size: Math.round(value) })}
      onPointerDown={event => {
        if (event.button !== 0 || hidden) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, value, kind, before: kind === 'tree' ? preferences.treeWidth : preferences.propertiesWidth }; setResizing(true);
      }} onPointerMove={event => {
        const current = drag.current; if (current?.pointer === event.pointerId) size(current.kind, current.value + (event.clientX - current.x) * (current.kind === 'tree' ? 1 : -1));
      }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = undefined; setResizing(false); }}
      onLostPointerCapture={() => { drag.current = undefined; setResizing(false); }} onPointerCancel={() => { drag.current = undefined; setResizing(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) {
          const current = drag.current; update(current.kind === 'tree' ? { treeWidth: current.before } : { propertiesWidth: current.before });
          event.currentTarget.releasePointerCapture(current.pointer); drag.current = undefined; setResizing(false); event.preventDefault(); return;
        }
        const step = event.shiftKey ? 50 : 10, direction = kind === 'tree' ? 1 : -1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') size(kind, value + (event.key === 'ArrowRight' ? step : -step) * direction);
        else if (event.key === 'Home') size(kind, min);
        else if (event.key === 'End') size(kind, max);
        else return;
        event.preventDefault();
      }} />;
  };
  const track = layout.mode === 'single' ? 'minmax(0,1fr)' : `${layout.tree}px ${panelGap}px minmax(0,1fr)${layout.mode === 'wide' && !layout.collapsed ? ` ${panelGap}px ${layout.properties}px` : ''}`;
  return <div className="model-workspace-shell" ref={root} data-mode={layout.mode} onScrollCapture={event => {
    const element = event.target as HTMLElement; if (!element.getClientRects().length) return;
    for (const panel of ['properties', 'preview'] as const) if (element.matches(scrollSelectors[panel])) state.scroll[panel] = element.scrollTop;
  }}>
    <div className="model-panel-tools">
      {actions}
      {controls}
      <div className="model-panel-settings">
      {layout.mode !== 'wide' && <div role="tablist" aria-label={t('模型面板')}>
        {panels.map(panel => <button key={panel} ref={node => { tabs.current[panel] = node; }} role="tab" id={tabId(panel)} aria-controls={panelId(panel)} aria-selected={visible(panel) && (panel !== 'tree' || layout.mode === 'single')}
          tabIndex={visible(panel) ? 0 : -1} onClick={() => update({ active: panel })} onKeyDown={event => tabKey(event, panel)}>{label(panel)}</button>)}
      </div>}
      <Space wrap>
        {layout.mode === 'wide' && <Button aria-expanded={!layout.collapsed} aria-controls={panelId('properties')} onClick={() => update({ propertiesCollapsed: !preferences.propertiesCollapsed })}>{layout.collapsed ? t('显示属性') : t('收起属性')}</Button>}
        <Button ref={reset} onClick={() => update({ ...createModelLayoutState(), scroll: state.scroll })}>{t('重置面板布局')}</Button>
        <ParameterHelp name={t('重置面板布局')} help="拖动分隔条，或聚焦后用方向键调整宽度；Shift 加速，Home / End 到边界。" />
      </Space>
      </div>
    </div>
    <span className="visually-hidden" id={`${id}-help`}>{t('拖动分隔条，或聚焦后用方向键调整宽度；Shift 加速，Home / End 到边界。')}</span>
    <div className={`robot-workspace${resizing ? ' is-resizing' : ''}`} style={{ gridTemplateColumns: track, height }}>
      {([tree, preview, properties] as const).map((content, index) => {
        const panel = (['tree', 'preview', 'properties'] as const)[index], tabbed = layout.mode === 'single' || layout.mode === 'dual' && panel !== 'tree';
        return <div className={`model-pane model-pane-${panel}`} data-model-panel={panel} key={panel} id={panelId(panel)} hidden={!visible(panel)}
          role={tabbed ? 'tabpanel' : 'region'} aria-label={tabbed ? undefined : label(panel)} aria-labelledby={tabbed ? tabId(panel) : undefined} tabIndex={-1}>
          {content}
        </div>;
      })}
      {separator('tree')}{separator('properties')}
    </div>
  </div>;
}
