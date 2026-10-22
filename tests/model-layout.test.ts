import { expect, it } from 'vitest';
import { createModelLayoutState, layoutMode, modelLayout, panelGap } from '../src/components/modelLayout';

it('chooses modes by workspace width, including exact boundaries', () => {
  expect([300, 700, 701, 1100, 1101, 1600].map(layoutMode)).toEqual(['single', 'single', 'dual', 'dual', 'wide', 'wide']);
});
it('keeps three panes usable while clamping large stored widths without losing their preference', () => {
  const state = { ...createModelLayoutState(), treeWidth: 480, propertiesWidth: 520 }, before = structuredClone(state);
  for (const width of [1101, 1120, 1360, 1600]) {
    const layout = modelLayout(width, state);
    expect(layout.tree).toBeGreaterThanOrEqual(240); expect(layout.properties).toBeGreaterThanOrEqual(320);
    expect(width - layout.tree - layout.properties - 2 * panelGap).toBeGreaterThanOrEqual(320);
  }
  expect(state).toEqual(before); expect(modelLayout(1600, state)).toMatchObject({ tree: 480, properties: 520 });
});
it('preserves a usable centre in dual mode and hides sizes without modifying preferences in single mode', () => {
  const state = { ...createModelLayoutState(), treeWidth: 480 };
  expect(modelLayout(701, state).tree).toBe(701 - 320 - panelGap);
  expect(modelLayout(700, state)).toMatchObject({ mode: 'single', tree: 0, properties: 0 });
  expect(state.treeWidth).toBe(480);
});
it('collapses properties on wide screens and leaves enough room for tree resizing', () => {
  const state = { ...createModelLayoutState(), propertiesCollapsed: true };
  expect(modelLayout(1200, state)).toMatchObject({ mode: 'wide', collapsed: true, properties: 0, treeMax: 480 });
  expect(modelLayout(900, state).collapsed).toBe(false);
});
