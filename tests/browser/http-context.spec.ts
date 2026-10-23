import { expect, test, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { uiOrigin } from './helpers/origin';
import { openProject } from '../../src/core/project/archive';

test('plain HTTP opens the Talon example, creates projects and saves/reopens archives without secure-only crypto', async ({ page, context, browser }, info) => {
  test.setTimeout(90000);
  const origin = 'http://rocos-http.test', errors: string[] = [];
  // A non-loopback HTTP origin is genuinely insecure, unlike localhost. All
  // requests are fulfilled from the test server, including dedicated workers.
  const proxy = async (route: Route) => {
    const response = await route.fetch({ url: uiOrigin + route.request().url().slice(origin.length) });
    await route.fulfill({ response });
  };
  await context.route(origin + '/**', proxy);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  expect(await page.evaluate(() => ({ secure: isSecureContext, subtle: typeof crypto.subtle, uuid: typeof crypto.randomUUID,
    random: typeof crypto.getRandomValues }))).toEqual({ secure: false, subtle: 'undefined', uuid: 'undefined', random: 'function' });
  await page.getByRole('button', { name: '打开示例', exact: true }).click();
  await expect(page.locator('.project-name strong')).toHaveText('Talon', { timeout: 30000 });
  await expect(page.locator('.stats .ant-card').nth(2)).toContainText('7');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const path = info.outputPath('http-talon.rcproj'); await (await download).saveAs(path);
  const saved = await openProject(await readFile(path));
  expect(saved.name).toBe('Talon');
  expect(saved.files.filter(file => /\.stl$/i.test(file.path))).toHaveLength(8);
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
  await page.reload();
  await page.locator('input[type=file]').first().setInputFiles(path);
  await expect(page.locator('.project-name strong')).toHaveText('Talon', { timeout: 30000 });
  // A separate page has no open project or unsaved edits, so new project
  // creation also exercises the HTTP UUID and recovery-session paths.
  const freshContext = await browser.newContext(); await freshContext.route(origin + '/**', proxy);
  const fresh = await freshContext.newPage(); fresh.on('pageerror', error => errors.push(error.message));
  await fresh.goto(origin + '/');
  await fresh.getByRole('button', { name: '新建工程', exact: true }).click();
  await fresh.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(fresh.locator('#project-name')).toHaveValue('我的机器人');
  await freshContext.close();
  expect(errors).toEqual([]);
});
