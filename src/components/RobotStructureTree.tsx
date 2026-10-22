import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Tree } from 'antd';
import { t } from '../i18n';
import type { StructureViewState } from './modelViewState';

export interface StructureNode { key: string; title: string; children?: StructureNode[]; selectable?: boolean }
export interface StructureTreeHandle { reveal: (key: string) => void }

const filterNodes = (nodes: StructureNode[], query: string): StructureNode[] => nodes.flatMap(node => {
  if (node.title.toLowerCase().includes(query.toLowerCase())) return [node];
  const children = filterNodes(node.children || [], query);
  return children.length ? [{ ...node, children }] : [];
});
function paths(nodes: StructureNode[], ancestors: string[] = [], result = new Map<string, string[]>()) {
  for (const node of nodes) {
    result.set(node.key, ancestors);
    paths(node.children || [], [...ancestors, node.key], result);
  }
  return result;
}

/** Expansion and reveal requests are local view state, never project changes. */
export const RobotStructureTree = forwardRef<StructureTreeHandle, {
  nodes: StructureNode[]; selected: string; search: string;
  viewState: StructureViewState;
  onSearchChange: (query: string) => void; onSelect: (key: string) => void;
}>(function RobotStructureTree({ nodes, selected, search, onSearchChange, onSelect, viewState }, ref) {
  const allPaths = paths(nodes), visible = filterNodes(nodes, search), visiblePaths = paths(visible);
  const [expanded, setExpanded] = useState(() => viewState.expanded || [...allPaths.keys()]);
  const [filtered, setFiltered] = useState<{ query: string; keys: string[] }>(() => viewState.filtered || { query: '', keys: [] });
  const [, requestRender] = useState(0);
  const host = useRef<HTMLDivElement>(null), pendingScroll = useRef(false);
  useEffect(() => { viewState.expanded = expanded; viewState.filtered = filtered; }, [expanded, filtered, viewState]);
  useLayoutEffect(() => { if (host.current) host.current.scrollTop = viewState.scrollTop; }, []);
  const activeKeys = search ? (filtered.query === search ? filtered.keys : [...visiblePaths.keys()]) : expanded;
  useImperativeHandle(ref, () => ({ reveal(key) {
    const ancestors = allPaths.get(key); if (!ancestors) return;
    const keys = (previous: string[]) => [...new Set([...previous, ...ancestors])];
    if (search && visiblePaths.has(key)) setFiltered({ query: search, keys: keys(activeKeys) });
    else {
      if (search) onSearchChange('');
      setExpanded(keys);
    }
    pendingScroll.current = true;
    requestRender(value => value + 1);
  } }));
  useLayoutEffect(() => {
    if (!pendingScroll.current) return;
    const row = host.current?.querySelector('.ant-tree-treenode-selected');
    if (row) { row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); pendingScroll.current = false; }
  });
  return <div className="model-tree" ref={host} onScroll={e => { viewState.scrollTop = e.currentTarget.scrollTop; }}><Tree aria-label={t('机器人结构树')}
    treeData={visible} selectedKeys={[selected]} expandedKeys={activeKeys} autoExpandParent={false}
    onExpand={keys => {
      const values = keys.map(String);
      if (search) setFiltered({ query: search, keys: values }); else setExpanded(values);
    }}
    onSelect={keys => onSelect(String(keys[0] || ''))} /></div>;
});
