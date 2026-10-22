import { projectSnapshot as snapshot } from './helpers/project';
import { renderedFrame } from './helpers/preview';
import { expect, test, type Page } from '@playwright/test';
import { previewProject } from '../fixtures/preview';
import { saveProject } from '../../src/core/project/archive';

async function open(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'display.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(previewProject())) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(page.getByLabel('机器人三维预览')).toBeVisible();
  await page.getByRole('button', { name: '适应模型', exact: true }).click();
}
async function collision(page: Page) {
  if (await page.getByRole('button', { name: '显示 Collision', exact: true }).getAttribute('aria-pressed') === 'false') await page.getByRole('button', { name: '显示 Collision', exact: true }).click();
  if (await page.getByRole('button', { name: '显示 Visual', exact: true }).getAttribute('aria-pressed') === 'true') await page.getByRole('button', { name: '显示 Visual', exact: true }).click();
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
}

test('geometry display and picking use visible collision shapes without changing project data', async ({ page }) => {
  await open(page); const before = await snapshot(page), canvas = page.locator('.robot-preview canvas');
  await canvas.evaluate(el => el.setAttribute('data-canvas-identity', 'retained'));
  const visual = await canvas.screenshot(); await collision(page);
  await expect.poll(async () => Buffer.compare(visual, await canvas.screenshot())).not.toBe(0);
  await expect(canvas).toHaveAttribute('data-canvas-identity', 'retained');
  await page.getByRole('button', { name: /^正\s*视$/ }).click();
  const size = (await canvas.boundingBox())!; await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected', 'link:collision_only');
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('collision_only');
  expect(await snapshot(page)).toBe(before);
});

test('page navigation retains camera, pose, selected node, geometry mode, tree expansion and search', async ({ page }) => {
  await open(page); const before = await snapshot(page);
  await page.getByText('joint_1 [revolute]', { exact: true }).click();
  const slider = page.getByRole('slider', { name: '关节预览位置' }); await slider.focus(); await slider.press('End');
  await collision(page); await page.getByRole('button', { name: /^正\s*视$/ }).click();
  await page.locator('.model-tree .ant-tree-switcher_open').first().click();
  const canvas = page.locator('.robot-preview canvas'), image = await renderedFrame(canvas);
  await page.getByRole('menuitem', { name: 'APP 配置', exact: true }).click();
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected', 'joint:joint_1');
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
  await expect(page.getByText('joint_1 [revolute]', { exact: true })).not.toBeVisible();
  await expect.poll(async () => Buffer.compare(image, await renderedFrame(canvas))).toBe(0);
  const search = page.getByRole('searchbox', { name: '搜索模型节点' }); await search.fill('collision_only');
  await expect(search).toHaveValue('collision_only');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('menuitem', { name: '主站配置', exact: true }).click();
    await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
    await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'wide');
    await expect(search).toHaveValue('collision_only');
    await expect(page.getByText('joint_1 [revolute]', { exact: true })).not.toBeVisible();
    await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected', 'joint:joint_1');
  }
  expect(await snapshot(page)).toBe(before);
});

for (const { name, touch, viewport } of [{name:'keyboard',touch:false,viewport:{width:1440,height:1000}}, {name:'touch',touch:true,viewport:{width:768,height:1024}}, {name:'narrow touch',touch:true,viewport:{width:390,height:844}}]) test.describe(`expanded preview ${name}`, () => {
  test.use({ hasTouch: touch, viewport });
  test('retains canvas, confines focus, exits with Escape/button and follows dark English UI', async ({ page }, info) => {
    await open(page); const before = await snapshot(page), canvas = page.locator('.robot-preview canvas');
    await canvas.evaluate(el => el.setAttribute('data-canvas-identity', 'retained'));
    const more = page.getByRole('button', { name: '更多操作', exact: true });
    if (await more.isVisible()) await more.click();
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('button', { name: '切换语言', exact: true }).click();
    await page.getByRole('menuitem', { name: 'English', exact: true }).click();
    await canvas.screenshot({ path: info.outputPath('normal-canvas.png') });
    const normal = await renderedFrame(canvas), trigger = page.getByRole('button', { name: 'Expand view', exact: true });
    if (touch) await trigger.tap(); else await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Expanded model view', exact: true }); await expect(dialog).toBeVisible();
    const exit = dialog.getByRole('button', { name: 'Exit expanded view', exact: true }); await expect(exit).toBeFocused();
    expect(await page.locator('.sidebar').evaluate(el => !!el.closest('[inert]'))).toBe(true);
    await expect(page.locator('canvas')).toHaveCount(1); await expect(canvas).toHaveAttribute('data-canvas-identity', 'retained');
    const bounds = (await canvas.boundingBox())!; expect(bounds.width).toBeGreaterThan(Math.min(viewport.width - 50, 1300));
    const exitBounds = (await exit.boundingBox())!; expect(exitBounds.height).toBeGreaterThanOrEqual(touch ? 44 : 32); expect(exitBounds.y + exitBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    for (const control of await dialog.getByRole('button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(touch ? 44 : 32);
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true); }
    await dialog.getByRole('button', { name: 'Show Collision', exact: true }).click();
    await dialog.getByRole('button', { name: 'Show Visual', exact: true }).click();
    await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
    await dialog.locator('.ant-select[aria-label="Preview joint"]').click();
    await dialog.locator('.ant-select-item-option').filter({ hasText: 'joint_1' }).click();
    await dialog.getByRole('button', { name: 'Show Collision', exact: true }).click();
    await dialog.getByRole('button', { name: 'Show Visual', exact: true }).click();
    await page.screenshot({ path: info.outputPath('expanded-dark-english.png') });
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
    expect(await page.locator('.sidebar').evaluate(el => !!el.closest('[inert]'))).toBe(false);
    expect(await page.locator('.sidebar').evaluate(el => !!el.closest('[aria-hidden=true]'))).toBe(false);
    await expect(canvas).toHaveAttribute('data-canvas-identity', 'retained');
    await canvas.screenshot({ path: info.outputPath('restored-canvas.png') });
    await expect.poll(async () => Buffer.compare(normal, await renderedFrame(canvas))).toBe(0);
    if (touch) { await trigger.tap(); await exit.tap(); } else { await trigger.click(); await exit.click(); }
    await expect(dialog).not.toBeVisible(); expect(await snapshot(page)).toBe(before);
  });
});
