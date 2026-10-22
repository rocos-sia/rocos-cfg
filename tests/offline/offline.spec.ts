import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openProject, saveProject } from '../../src/core/project/archive';
import { packZip, unpackZip } from '../../src/core/project/zip';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { assertBundledFonts } from '../browser/helpers/fonts';

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
  await offline.getByRole('spinbutton',{name:/^通信周期/}).fill('3000');
  await offline.getByRole('spinbutton',{name:/^通信周期/}).blur();
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
  await expect(offline.getByRole('spinbutton',{name:/^通信周期/})).toHaveValue('3000');
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
    const font = (await cache.keys()).find(request => request.url.endsWith('.woff2'));
    if (!font) throw Error('Missing precached font');
    await cache.delete(font);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status').filter({ hasText: '离线缓存不完整' })).toBeVisible();
  await page.getByRole('button', { name: '修复缓存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已可离线使用' })).toBeVisible();
});

test('all font weights and notices survive an offline restart without HTTP cache', async ({ page, context }) => {
  await page.goto('./'); await expect(page.getByRole('status').filter({ hasText: '已可离线使用' })).toBeVisible();
  const cached = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find(name => name.startsWith('rocos-shell:'))!);
    return (await cache.keys()).map(request => request.url);
  });
  expect(cached.filter(url => url.endsWith('.woff2'))).toHaveLength(4);
  expect(cached.some(url => url.endsWith('/licenses/AlibabaPuHuiTi-3.0.txt'))).toBe(true);
  expect(cached.some(url => url.endsWith('/licenses/font-sources.json'))).toBe(true);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.clearBrowserCache'); await cdp.detach();
  await context.setOffline(true); await page.close();
  const offline = await context.newPage(), fonts = new Set<string>();
  offline.on('response', response => { if (response.url().endsWith('.woff2') && response.fromServiceWorker()) fonts.add(response.url()); });
  await offline.goto('./'); await assertBundledFonts(offline); expect(fonts.size).toBe(4);
  const notice = await offline.evaluate(async () => (await fetch('./licenses/AlibabaPuHuiTi-3.0.txt')).text());
  expect(notice).toContain('《阿里巴巴普惠体3.0版》法律声明'); expect(notice).toContain('Legal Notice for Alibaba PuHuiTi 3.0');
});

test('both bundled teaching examples remain editable and exportable after a cached restart offline',async({page,context},info)=>{
  await page.goto('./');await expect(page.getByRole('status').filter({hasText:'已可离线使用'})).toBeVisible();
  await context.setOffline(true);await page.reload();
  for(const [index,kind] of (['igh','ecm'] as const).entries()){
    await page.getByRole('button',{name:'打开示例',exact:true}).click();
    await page.getByRole('button',{name:kind==='igh'?'打开 IgH 示例':'打开 EC-Master 示例',exact:true}).click();
    if(index)await page.getByRole('button',{name:'打开新工程',exact:true}).click();
    await expect(page.getByText('教学示例',{exact:true})).toBeVisible();
    await page.getByRole('menuitem',{name:'主站配置',exact:true}).click();
    await expect(page.locator('.bus-topology .react-flow__node')).toHaveCount(2);
    await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
    await page.getByRole('button',{name:'格式化 URDF',exact:true}).click();
    await expect(page.getByRole('button',{name:'放弃草稿',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'应用修改',exact:true}).click();
    await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
    await page.getByRole('spinbutton',{name:'HTTP 端口',exact:true}).fill(String(8090+index));await page.getByRole('spinbutton',{name:'HTTP 端口',exact:true}).blur();
    await page.getByRole('menuitem',{name:'硬件与绑定',exact:true}).click();
    await page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true}).check();
    const saving=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
    const archivePath=info.outputPath(`${kind}-offline.rcproj`);await(await saving).saveAs(archivePath);
    const restored=await openProject(await readFile(archivePath));expect(restored.entrypoints.master.kind).toBe(kind);
    await page.getByRole('menuitem',{name:'校验与导出',exact:true}).click();await page.getByRole('button',{name:'检查并导出配置',exact:true}).click();
    const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'下载运行包',exact:true}).click();
    const runtimePath=info.outputPath(`${kind}-offline-runtime.zip`);await(await exporting).saveAs(runtimePath);
    const runtime=unpackZip(await readFile(runtimePath));expect(runtime.has(`master/${kind}.yaml`)).toBe(true);
    if(kind==='ecm')expect(runtime.get('master/eni.xml')).toEqual(fileById(restored,restored.entrypoints.master.eniFileId)!.bytes);
    await page.getByRole('menuitem',{name:'工程总览',exact:true}).click();
  }
});
