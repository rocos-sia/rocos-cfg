export type ModelPanel = 'tree' | 'preview' | 'properties';
export interface ModelLayoutState {
  treeWidth: number; propertiesWidth: number; propertiesCollapsed: boolean; active: ModelPanel;
  scroll: { properties: number; preview: number };
}
export const createModelLayoutState = (): ModelLayoutState => ({ treeWidth: 280, propertiesWidth: 360, propertiesCollapsed: false, active: 'preview', scroll: { properties: 0, preview: 0 } });
export const layoutMode = (width: number) => width <= 700 ? 'single' : width <= 1100 ? 'dual' : 'wide';
export const panelGap = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Number.isFinite(value) ? value : min, max));

/** Clamp the visible layout without overwriting a user's larger-screen preference. */
export function modelLayout(width: number, state: ModelLayoutState) {
  const mode = layoutMode(width), collapsed = mode === 'wide' && state.propertiesCollapsed;
  const propertiesMax = Math.min(520, width - 240 - 320 - 2 * panelGap);
  const properties = mode === 'wide' && !collapsed ? clamp(state.propertiesWidth, 320, propertiesMax) : 0;
  const treeMax = Math.min(480, width - 320 - properties - panelGap * (properties ? 2 : 1));
  const tree = mode === 'single' ? 0 : clamp(state.treeWidth, 240, treeMax);
  return { mode, tree, treeMax, properties, propertiesMax, collapsed };
}
