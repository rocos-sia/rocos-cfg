import { expect, test, type Page } from '@playwright/test';
import { previewProject } from '../fixtures/preview';
import { saveProject } from '../../src/core/project/archive';
import { projectSnapshot } from './helpers/project';
import { assertBundledFonts } from './helpers/fonts';

async function open(page: Page) {
  await page.goto('/'); const project = previewProject();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'shell.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(project)) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click(); await assertBundledFonts(page);
  await expect(page.locator('.robot-preview canvas')).toBeVisible();
}

test('explicit sidebar preference survives resize and reload without changing project or mounted editors', async ({ page }) => {
  await open(page); const canvas = page.locator('.robot-preview canvas'), source = page.getByRole('textbox', { name: '配置源码', exact: true });
  await canvas.evaluate(el => el.setAttribute('data-shell-identity', 'retained'));
  await source.fill('<robot name="pending"'); await source.blur();
  await page.getByRole('button', { name: '保留源码草稿', exact: true }).click();
  await expect(page.getByText('源码草稿尚未应用，运行配置导出将被阻止', { exact: true })).toBeVisible();
  await source.evaluate(el => el.setAttribute('data-shell-identity', 'retained')); const before = await projectSnapshot(page);
  await page.getByRole('button', { name: '收起导航', exact: true }).click(); await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'true');
  await expect(canvas).toHaveAttribute('data-shell-identity', 'retained'); await expect(source).toHaveAttribute('data-shell-identity', 'retained');
  await page.setViewportSize({ width: 1024, height: 900 }); await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'false');
  expect(await projectSnapshot(page)).toBe(before); await expect(source).toHaveText('<robot name="pending"');
  await page.reload(); await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('rocos.sidebar.collapsed'))).toBe('false');
});

test('default compact navigation follows the breakpoint until the user chooses a preference', async ({ page }) => {
  await page.setViewportSize({ width: 1199, height: 900 }); await open(page); const before = await projectSnapshot(page);
  await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'true');
  await page.setViewportSize({ width: 1200, height: 900 }); await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'false');
  await page.setViewportSize({ width: 1199, height: 900 }); await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed', 'true');
  expect(await projectSnapshot(page)).toBe(before);
});

test('phone navigation confines keyboard focus, closes on Escape or route choice and preserves canvas dimensions', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page); const before = await projectSnapshot(page);
  const main = (await page.locator('.main-shell').boundingBox())!, canvas = page.locator('.robot-preview canvas');
  await canvas.evaluate(el => el.setAttribute('data-shell-identity', 'retained'));
  await page.getByRole('button', { name: '展开导航', exact: true }).focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '工程导航', exact: true }); await expect(dialog).toBeVisible(); await expect(page.locator('.main-shell')).toHaveAttribute('inert', '');
  expect((await page.locator('.main-shell').boundingBox())!.width).toBe(main.width);
  const close = dialog.getByRole('button', { name: '关闭导航', exact: true }); await expect(close).toBeFocused();
  for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('.sidebar'))).toBe(true); }
  await close.focus(); await page.keyboard.press('Shift+Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('.sidebar'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: '展开导航', exact: true })).toBeFocused();
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert', ''); await expect(canvas).toHaveAttribute('data-shell-identity', 'retained');
  expect(await projectSnapshot(page)).toBe(before);
  await page.getByRole('button', { name: '展开导航', exact: true }).click(); await dialog.getByRole('menuitem', { name: 'APP 配置', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('heading', { name: 'APP 配置', exact: true })).toBeVisible(); expect(await projectSnapshot(page)).toBe(before);
  await page.getByRole('button', { name: '展开导航', exact: true }).click(); await page.setViewportSize({ width: 1200, height: 900 });
  await expect(dialog).not.toBeVisible(); await expect(page.locator('.main-shell')).not.toHaveAttribute('inert', '');
  await page.screenshot({ path: info.outputPath('navigation-after-breakpoint.png') });
});

test('compact actions preserve controls and focus through language, theme and breakpoint changes', async ({ page }, info) => {
  await open(page); const before = await projectSnapshot(page), language = page.getByRole('button', { name: '切换语言', exact: true });
  await language.evaluate(el => el.setAttribute('data-shell-identity', 'retained')); await language.focus();
  await page.setViewportSize({ width: 899, height: 900 }); await expect(language).toBeFocused();
  const more = page.getByRole('button', { name: '更多操作', exact: true }); await expect(more).toHaveAttribute('aria-expanded', 'true');
  const recovery = page.getByRole('button', { name: '本机恢复草稿', exact: true });
  await recovery.click(); const recoveryDialog = page.getByRole('dialog', { name: '本机恢复草稿', exact: true }); await expect(recoveryDialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(recoveryDialog).not.toBeVisible(); await expect(more).toHaveAttribute('aria-expanded', 'true'); await expect(recovery).toBeFocused();
  await language.click(); await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change language', exact: true })).toHaveAttribute('data-shell-identity', 'retained');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click(); await expect(page.locator('.shell')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape'); const englishMore = page.getByRole('button', { name: 'More actions', exact: true }); await expect(englishMore).toBeFocused();
  await expect(page.getByRole('button', { name: 'Change language', exact: true })).not.toBeVisible();
  await englishMore.press('Enter'); await page.getByRole('button', { name: 'Change language', exact: true }).focus(); await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('button', { name: 'Change language', exact: true })).toBeFocused(); expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({ path: info.outputPath('expanded-dark-english.png') });
});

test('long names keep file actions and footer available in desktop, Pad, phone and low-height windows', async ({ page }, info) => {
  await open(page); await page.getByRole('menuitem', { name: '工程总览', exact: true }).click();
  await page.locator('.overview-grid input').first().fill('长工程名称 · project with a very long name 0123456789 '.repeat(4)); await page.locator('.overview-grid input').first().blur();
  for (const [width, height] of [[1366,768], [1024,768], [390,844], [844,390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: '下载工程', exact: true })).toBeInViewport(); await expect(page.getByRole('button', { name: '校验工程', exact: true })).toBeInViewport();
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth && el.scrollHeight <= innerHeight)).toBe(true);
    expect((await page.locator('.workspace').boundingBox())!.height).toBeGreaterThan(90);
    await page.screenshot({ path: info.outputPath(`shell-${width}-${height}.png`) });
  }
});

test('phone touch navigation, backdrop and compact preferences remain usable', async ({ browser }, info) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } }), page = await context.newPage(); await open(page);
  const before = await projectSnapshot(page), toggle = page.getByRole('button', { name: '展开导航', exact: true });
  const bounds = (await toggle.boundingBox())!; expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
  await toggle.tap(); await page.getByRole('dialog', { name: '工程导航', exact: true }).getByRole('menuitem', { name: '主站配置', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '主站配置', exact: true })).toBeVisible();
  await toggle.tap(); await page.locator('.nav-backdrop').tap({ position: { x: 360, y: 200 } }); await expect(page.getByRole('dialog', { name: '工程导航', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '更多操作', exact: true }).tap(); await page.getByRole('button', { name: '切换主题', exact: true }).tap();
  await page.getByRole('button', { name: '更多操作', exact: true }).tap(); expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({ path: info.outputPath('phone-touch-shell.png') }); await context.close();
});
