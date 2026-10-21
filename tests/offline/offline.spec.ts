import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openProject, saveProject } from '../../src/core/project/archive';
import { packZip, unpackZip } from '../../src/core/project/zip';
import { fileById, textOf, utf8 } from '../../src/core/project/types';

test('complete precache supports unopened pages and project roundtrip offline under repository path', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4174/') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url());
  });
  await page.goto('./');
  await expect(page.getByRole('status').filter({ hasText: '已可离线使用' })).toBeVisible();
  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const manifest = await (await fetch('manifest.webmanifest')).json();
    const cacheName=(await caches.keys()).find(name=>name.startsWith('rocos-shell:'))!;
    const cached=await (await caches.open(cacheName)).keys();
    return { scope: reg.scope, start: new URL(manifest.start_url, location.href).pathname,worker:cached.some(request=>request.url.includes('/assets/archive.worker-')) };
  });
  expect(registration.scope).toBe('http://127.0.0.1:4174/rocos-configurator/');
  expect(registration.start).toBe('/rocos-configurator/');
  expect(registration.worker).toBe(true);
  await context.setOffline(true);
  // A fresh tab reloads the shell from the service worker without any HTTP cache.
  await page.close();
  const offline = await context.newPage();
  offline.on('pageerror', error => errors.push(error.message));
  await offline.goto('./');
  await offline.getByRole('button',{name:'切换语言',exact:true}).click();await offline.getByRole('menuitem',{name:'English',exact:true}).click();
  await offline.reload();await expect(offline.locator('html')).toHaveAttribute('lang','en-US');
  await expect(offline.getByRole('status').filter({hasText:'Ready for offline use'})).toBeVisible();
  await offline.getByRole('button',{name:'Change language',exact:true}).click();await offline.getByRole('menuitem',{name:'简体中文',exact:true}).click();
  await offline.getByRole('button', { name: '新建工程', exact: true }).click();
  await offline.getByRole('dialog').getByRole('textbox').fill('离线配置工程');
  await offline.getByRole('dialog').locator('.ant-select[aria-label="初始模型模板"]').click();
  await offline.getByTitle('双关节演示模型', { exact: true }).click();
  await offline.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(offline.getByText('快照已核对', { exact: true })).toHaveCount(2);
  await offline.getByRole('menuitem', { name: '主站配置' }).click();
  await offline.getByLabel('通信周期').fill('3000');
  await offline.getByLabel('通信周期').blur();
  for (const name of ['机器人模型', '硬件与绑定', 'APP 配置']) {
    await offline.getByRole('menuitem', { name }).click();
    await expect(offline.locator('main h1')).toBeVisible();
  }
  await offline.getByRole('button', { name: '校验工程', exact: true }).click();
  await expect(offline.getByText('诊断结果', { exact: true })).toBeVisible();
  const downloaded = offline.waitForEvent('download');
  await offline.getByRole('button', { name: '下载工程', exact: true }).click();
  const archive = testInfo.outputPath('offline.rcproj');
  await (await downloaded).saveAs(archive);
  const saved = await openProject(await readFile(archive));
  expect(saved.editor.templateUses?.some(use => use.templateId === 'robot.two-axis')).toBe(true);
  expect(saved.files.filter(file => file.role === 'profile')).toHaveLength(2);
  const largeModel=fileById(saved,saved.entrypoints.urdf)!;largeModel.bytes=utf8.encode(textOf(largeModel)+'\n<!--'+'padding '.repeat(36000)+'-->');
  await offline.locator('input[type=file]').first().setInputFiles({name:'offline-large.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(saved))});
  await offline.getByRole('button', { name: '打开新工程', exact: true }).click();
  await offline.getByRole('menuitem', { name: '主站配置' }).click();
  await expect(offline.getByLabel('通信周期')).toHaveValue('3000');
  await offline.screenshot({ path: testInfo.outputPath('offline-master.png'), fullPage: true });
  await offline.getByRole('menuitem',{name:'机器人模型'}).click();await expect(offline.locator('.model-tree')).toContainText('arm_joint_2');
  const contents=unpackZip(await readFile(archive));contents.set('master/igh.yaml',utf8.encode('damaged master'));
  await offline.locator('input[type=file]').first().setInputFiles({name:'damaged.rcproj',mimeType:'application/zip',buffer:Buffer.from(packZip(contents))});
  const recovery=offline.getByRole('dialog',{name:'工程完整性检查失败'});
  await recovery.getByRole('button',{name:'检查可恢复文件'}).click();await recovery.getByRole('button',{name:'创建恢复工程'}).click();
  await offline.getByRole('dialog',{name:'切换工程'}).getByRole('button',{name:'打开新工程',exact:true}).click();
  const recoveredDownload=offline.waitForEvent('download');await offline.getByRole('button',{name:'下载工程',exact:true}).click();
  const recoveredPath=testInfo.outputPath('offline-recovered.rcproj');await(await recoveredDownload).saveAs(recoveredPath);
  const recovered=await openProject(await readFile(recoveredPath));expect(recovered.name).toBe('离线配置工程（恢复）');expect(recovered.entrypoints.master.fileId).toBeNull();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('cache completeness is rechecked instead of claiming offline readiness after eviction', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('status').filter({ hasText: '已可离线使用' })).toBeVisible();
  await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find(name => name.startsWith('rocos-shell:'))!);
    await cache.delete(new URL('icon.svg', location.href).href);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status').filter({ hasText: '离线缓存不完整' })).toBeVisible();
  await page.getByRole('button', { name: '修复缓存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已可离线使用' })).toBeVisible();
});
