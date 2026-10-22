import { expect, test, type Page } from '@playwright/test';
import { saveProject } from '../../src/core/project/archive';
import { previewProject } from '../fixtures/preview';
import { projectSnapshot } from './helpers/project';
import { renderedFrame } from './helpers/preview';

async function open(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'tools.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(previewProject())) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(page.locator('.preview-gizmo>div')).toHaveCount(1);
}

test('icon view toolbar fades near pointer, stays keyboard accessible and respects reduced motion', async ({ page }, info) => {
  await open(page); const before = await projectSnapshot(page);
  const bar = page.locator('.preview-view-tools .preview-icon-bar');
  await page.mouse.move(0, 0); await expect(bar).toHaveCSS('opacity', '0');
  await page.locator('.preview-view-tools').hover(); await expect(bar).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.mouse.move(0, 0); await expect(bar).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab'); await page.getByRole('button', { name: '正视', exact: true }).focus();
  await expect(bar).toHaveCSS('opacity', '1'); await page.keyboard.press('Enter');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(bar).toHaveCSS('transition-duration', '0s');
  expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({ path: info.outputPath('icon-toolbar.png') });
});

test('independent checked display buttons change the scene, persist across routes, and never edit the project', async ({ page }) => {
  await open(page); const before = await projectSnapshot(page), canvas = page.locator('.robot-preview canvas');
  const visual = page.getByRole('button', { name: '显示 Visual', exact: true }), collision = page.getByRole('button', { name: '显示 Collision', exact: true });
  const frame = await renderedFrame(canvas);
  await collision.click(); await expect(visual).toHaveAttribute('aria-pressed', 'true'); await expect(collision).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'both');
  await expect.poll(async () => Buffer.compare(frame, await renderedFrame(canvas))).not.toBe(0);
  await visual.click(); await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
  await collision.click(); await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'none');
  for (const name of ['显示坐标轴', '显示关节轴', '显示网格']) {
    const prior = await renderedFrame(canvas); await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(async () => Buffer.compare(prior, await renderedFrame(canvas))).not.toBe(0);
  }
  await page.getByRole('menuitem', { name: 'APP 配置', exact: true }).click();
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  for (const name of ['显示坐标轴', '显示关节轴', '显示网格', '显示 Collision', '显示 Visual']) await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.preview-gizmo>div')).toHaveCount(1); expect(await projectSnapshot(page)).toBe(before);
});

test('gizmo rotates with pointer and keyboard, follows expansion/resizing, and stays clear of narrow controls', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const before = await projectSnapshot(page), canvas = page.locator('.robot-preview canvas');
  const gizmo = page.getByRole('group', { name: '视角 Gizmo', exact: true });
  const frame = await renderedFrame(canvas), bounds = (await gizmo.boundingBox())!;
  await page.mouse.move(bounds.x + 44, bounds.y + 44); await page.mouse.down(); await page.mouse.move(bounds.x + 65, bounds.y + 28, { steps: 8 }); await page.mouse.up(); await page.mouse.move(0, 0);
  await expect.poll(async () => Buffer.compare(frame, await renderedFrame(canvas))).not.toBe(0);
  const rotated = await renderedFrame(canvas); await gizmo.focus(); await gizmo.press('z');
  await expect.poll(async () => Buffer.compare(rotated, await renderedFrame(canvas))).not.toBe(0);
  await page.getByRole('button', { name: '展开视图', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '退出展开视图', exact: true }).focus();
  const g = (await gizmo.boundingBox())!, controls = (await page.locator('.preview-controls').boundingBox())!;
  expect(g.y + g.height).toBeLessThanOrEqual(controls.y); expect(g.x).toBeGreaterThanOrEqual(0);
  await gizmo.focus(); await gizmo.press('Shift+X');
  await page.screenshot({ path: info.outputPath('gizmo-narrow.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({ path: info.outputPath('gizmo-dark.png') });
  expect(await projectSnapshot(page)).toBe(before); expect(errors).toEqual([]);
});

test('translucency changes actual model pixels, restores them and persists only for the current session', async ({ page }, info) => {
  await open(page); const before = await projectSnapshot(page), canvas = page.locator('.robot-preview canvas');
  const button = page.getByRole('button', { name: '半透明显示', exact: true });
  const original = await renderedFrame(canvas);
  await button.focus(); await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Buffer.compare(original, await renderedFrame(canvas))).not.toBe(0);
  await page.screenshot({ path: info.outputPath('translucent-arrows.png') });
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Buffer.compare(original, await renderedFrame(canvas))).toBe(0);
  await button.click();
  await page.getByRole('menuitem', { name: 'APP 配置', exact: true }).click();
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await projectSnapshot(page)).toBe(before);
});
