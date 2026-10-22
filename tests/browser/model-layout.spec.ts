import { projectSnapshot as snapshot } from './helpers/project';
import { expect, test, type Page } from '@playwright/test';
import { previewProject } from '../fixtures/preview';
import { saveProject } from '../../src/core/project/archive';
import { assertBundledFonts } from './helpers/fonts';

async function open(page: Page) {
  await page.goto('/'); await page.locator('input[type=file]').first().setInputFiles({ name: 'layout.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(previewProject())) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click(); await assertBundledFonts(page);
  await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'wide');
  const grid = (await page.locator('.robot-workspace').boundingBox())!, footer = (await page.locator('.bottom-bar').boundingBox())!;
  expect(grid.y + grid.height).toBeLessThanOrEqual(footer.y);
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test('keyboard and pointer resizing, collapse, reset and route changes preserve workspace data and canvas identity', async ({ page }, info) => {
  await open(page); const before = await snapshot(page), canvas = page.locator('.robot-preview canvas');
  await page.getByText('joint_1 [revolute]', { exact: true }).click();
  await canvas.evaluate(el => el.setAttribute('data-layout-identity', 'retained'));
  const tree = page.getByRole('separator', { name: '调整结构面板宽度', exact: true }), properties = page.getByRole('separator', { name: '调整属性面板宽度', exact: true });
  await tree.focus(); await tree.press('Shift+ArrowRight'); await expect(tree).toHaveAttribute('aria-valuenow', '330');
  await properties.focus(); await properties.press('ArrowLeft'); await expect(properties).toHaveAttribute('aria-valuenow', '370');
  const bounds = (await tree.boundingBox())!; expect(bounds.width).toBeGreaterThanOrEqual(44);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + 60); await page.mouse.up();
  await expect(tree).toHaveAttribute('aria-valuenow', '370');
  await page.getByRole('button', { name: '收起属性', exact: true }).click(); await expect(page.locator('.model-pane-properties')).not.toBeVisible();
  await page.getByRole('button', { name: '显示属性', exact: true }).click(); await expect(properties).toHaveAttribute('aria-valuenow', '370');
  await expect(canvas).toHaveAttribute('data-layout-identity', 'retained'); expect(await snapshot(page)).toBe(before);
  const stableHeight = (await page.locator('.robot-workspace').boundingBox())!.height;
  await page.getByRole('textbox', { name: '配置源码', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await page.locator('.robot-workspace').boundingBox())!.height).toBe(stableHeight);
  const scrollPanel = page.locator('.model-pane-properties>.ant-card>.ant-card-body'); await scrollPanel.evaluate(el => { el.scrollTop = 200; });
  await expect.poll(() => scrollPanel.evaluate(el => el.scrollTop)).toBe(200);
  await page.getByRole('menuitem', { name: 'APP 配置', exact: true }).click(); await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(tree).toHaveAttribute('aria-valuenow', '370'); await expect(properties).toHaveAttribute('aria-valuenow', '370');
  await expect.poll(() => scrollPanel.evaluate(el => el.scrollTop)).toBe(200);
  await page.getByRole('button', { name: '重置面板布局', exact: true }).click(); await expect(tree).toHaveAttribute('aria-valuenow', '280'); await expect(properties).toHaveAttribute('aria-valuenow', '360');
  await tree.focus(); await tree.press('End'); await expect(tree).toHaveAttribute('aria-valuenow', (await tree.getAttribute('aria-valuemax'))!);
  expect((await page.locator('.model-pane-preview').boundingBox())!.width).toBeGreaterThanOrEqual(320);
  await tree.press('Home'); await expect(tree).toHaveAttribute('aria-valuenow', '240');
  const cancelled = (await tree.boundingBox())!; await page.mouse.move(cancelled.x + 22, cancelled.y + 60); await page.mouse.down(); await page.mouse.move(cancelled.x + 52, cancelled.y + 60);
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(tree).toHaveAttribute('aria-valuenow', '240');
  await page.getByRole('button', { name: '重置面板布局', exact: true }).click();
  expect(await snapshot(page)).toBe(before); await page.screenshot({ path: info.outputPath('wide-panels.png') });
});

test('actual container width chooses tabs, keeps pending input and focus, and restores camera after hidden preview', async ({ page }, info) => {
  await open(page); await page.getByText('joint_1 [revolute]', { exact: true }).click();
  const canvas = page.locator('.robot-preview canvas'); await canvas.evaluate(el => el.setAttribute('data-layout-identity', 'retained'));
  await page.getByRole('button', { name: /^正\s*视$/ }).click();
  const slider = page.getByRole('slider', { name: '关节预览位置', exact: true }); await slider.focus(); await slider.press('End'); await slider.blur(); await expect(page.getByRole('tooltip')).not.toBeVisible();
  const image = await canvas.screenshot(), before = await snapshot(page), field = page.getByLabel('位置上限', { exact: true });
  await field.focus(); await field.fill('temporary invalid value');
  // Resize only the workspace, not the viewport; a media-query-only layout fails.
  await page.locator('.model-workspace-shell').evaluate(el => { (el as HTMLElement).style.width = '820px'; });
  await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'dual');
  await expect(field).toBeFocused(); await expect(field).toHaveValue('temporary invalid value'); await expect(tab(page, '属性')).toHaveAttribute('aria-selected', 'true');
  expect(await snapshot(page)).toBe(before);
  await field.fill('1'); await field.blur();
  await tab(page, '预览').click(); await tab(page, '属性').click(); await expect(field).toHaveValue('1');
  await tab(page, '预览').focus(); await page.keyboard.press('End'); await expect(tab(page, '属性')).toBeFocused(); await expect(field).toBeVisible();
  await page.keyboard.press('Home'); await expect(tab(page, '预览')).toBeFocused(); await expect(canvas).toBeVisible();
  await page.locator('.model-workspace-shell').evaluate(el => { (el as HTMLElement).style.width = ''; });
  await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'wide');
  await expect(canvas).toHaveAttribute('data-layout-identity', 'retained'); await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await expect.poll(async () => Buffer.compare(image, await canvas.screenshot())).toBe(0); expect(await snapshot(page)).toBe(before);
  await page.screenshot({ path: info.outputPath('restored-panels.png') });
});

test('single-panel tabs retain hidden tree selection and expanded preview stays usable through a breakpoint', async ({ page }, info) => {
  await open(page); const canvas = page.locator('.robot-preview canvas'), before = await snapshot(page);
  await canvas.evaluate(el => el.setAttribute('data-layout-identity', 'retained'));
  await page.setViewportSize({ width: 768, height: 900 }); await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'single');
  await tab(page, '结构').click(); await page.getByText('joint_1 [revolute]', { exact: true }).click();
  await tab(page, '属性').click(); await expect(page.getByLabel('位置上限', { exact: true })).toHaveValue('1');
  await tab(page, '预览').click(); await expect(canvas).toHaveAttribute('data-layout-identity', 'retained');
  await page.getByRole('button', { name: '适应模型', exact: true }).click(); const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await tab(page, '结构').click(); await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('visual_arm');
  await tab(page, '预览').click(); await page.getByRole('button', { name: '展开视图', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(page.getByRole('dialog', { name: '模型展开视图', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('dialog', { name: '模型展开视图', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '展开视图', exact: true })).toBeFocused();
  await expect(canvas).toHaveAttribute('data-layout-identity', 'retained'); expect(await snapshot(page)).toBe(before);
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('narrow-panels.png') });
});

test('Pad touch tabs preserve selection and resize handles expose a full touch target', async ({ browser, browserName }, info) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  await open(page); await page.setViewportSize({ width: 1024, height: 900 }); await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode', 'dual');
  const before = await snapshot(page), separator = page.getByRole('separator', { name: '调整结构面板宽度', exact: true }), bounds = (await separator.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page), x = bounds.x + bounds.width / 2, y = bounds.y + 60;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    await expect(separator).toHaveAttribute('aria-valuenow', '320');
  }
  await page.getByText('joint_1 [revolute]', { exact: true }).tap(); await tab(page, '属性').tap(); await expect(page.getByLabel('位置上限', { exact: true })).toHaveValue('1');
  await tab(page, '预览').tap(); await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected', 'joint:joint_1');
  expect(await snapshot(page)).toBe(before); await page.screenshot({ path: info.outputPath('pad-panels.png') }); await context.close();
});
