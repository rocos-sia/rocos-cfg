import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openProject, saveProject } from '../../src/core/project/archive';
import { createProject } from '../../src/core/project/create';
import { resourceProject } from '../fixtures/resources';

test('a busy archive worker can be cancelled while the workspace stays editable and the next save succeeds',async({page},testInfo)=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  await page.getByRole('button',{name:'创建工程',exact:true}).click();
  // Simulate expensive synchronous computation in the actual dedicated worker.
  // If it were on the UI thread, neither editing nor cancellation could work.
  await page.route('**/archive.worker.ts*',async route=>{
    await route.fulfill({contentType:'application/javascript',body:'self.onmessage=()=>{self.postMessage({type:"progress",percent:5}); const until=performance.now()+60000; while(performance.now()<until){};};'});
  },{times:1});
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  await page.getByRole('button',{name:'下载工程',exact:true}).click();
  await expect(page.locator('.file-transfer')).toContainText('5%');
  await page.locator('.overview-grid input').fill('取消后保留修改');await page.locator('.overview-grid input').blur();
  await page.getByRole('button',{name:'取消操作',exact:true}).click();
  await expect(page.locator('.file-transfer')).toHaveCount(0);expect(downloads).toEqual([]);
  await expect(page.locator('.project-name strong')).toHaveText('取消后保留修改');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('after-cancel.rcproj');await(await download).saveAs(path);
  expect((await openProject(await readFile(path))).name).toBe('取消后保留修改');
});

test('a save worker uses its captured revision and does not mark later edits as downloaded',async({page},testInfo)=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('captured revision');await page.getByRole('button',{name:'创建工程',exact:true}).click();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/archive.worker.ts*',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});},{times:1});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  await expect(page.locator('.file-transfer')).toBeVisible();
  await page.locator('.overview-grid input').fill('newer revision');await page.locator('.overview-grid input').blur();release();
  const path=testInfo.outputPath('captured.rcproj');await(await download).saveAs(path);
  expect((await openProject(await readFile(path))).name).toBe('captured revision');
  await expect(page.locator('.project-name strong')).toHaveText('newer revision');
  await expect(page.locator('.save-state')).toContainText('未保存');
});

test('cancelling archive inspection preserves the workspace and does not mislabel cancellation as corruption',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('keep workspace');await page.getByRole('button',{name:'创建工程',exact:true}).click();
  await page.route('**/archive.worker.ts*',async route=>{
    await route.fulfill({contentType:'application/javascript',body:'self.onmessage=()=>{self.postMessage({type:"progress",percent:5});const until=performance.now()+60000;while(performance.now()<until){};};'});
  },{times:1});
  const other={name:'other.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(createProject('other workspace','ecm')))};
  await page.locator('input[type=file]').first().setInputFiles(other);
  await expect(page.locator('.file-transfer')).toContainText('5%');await page.getByRole('button',{name:'取消操作',exact:true}).click();
  await expect(page.locator('.file-transfer')).toHaveCount(0);await expect(page.locator('.project-name strong')).toHaveText('keep workspace');
  await expect(page.getByRole('dialog',{name:'工程完整性检查失败'})).toHaveCount(0);
  await page.locator('input[type=file]').first().setInputFiles(other);
  const replacement=page.getByRole('dialog',{name:'切换工程'});await expect(replacement).toContainText('other workspace');
  // Cancellation also dismisses a pending replacement decision. Use the global
  // operation control through the modal overlay as a programmatic close event.
  await page.getByRole('button',{name:'取消操作',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(replacement).toHaveCount(0);await expect(page.locator('.project-name strong')).toHaveText('keep workspace');
});

test('background validation reports its captured revision and marks results stale after continued editing',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/archive.worker.ts*',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'校验工程',exact:true}).click();await expect(page.locator('.file-transfer')).toBeVisible();
  await page.getByRole('menuitem',{name:'工程总览'}).click();await page.locator('.overview-grid input').fill('edited during validation');await page.locator('.overview-grid input').blur();release();
  await expect(page.locator('.file-transfer')).toHaveCount(0);await page.getByRole('menuitem',{name:'校验与导出'}).click();
  await expect(page.getByText('结果已过期',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新校验',exact:true}).click();await expect(page.locator('.file-transfer')).toHaveCount(0);
  await expect(page.getByText('结果已过期',{exact:true})).toHaveCount(0);
});

test('runtime packaging discards an outdated plan and retries against the current project',async({page})=>{
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'runtime.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(resourceProject()))});
  await expect(page.locator('.project-name strong')).toHaveText('portable');await page.getByRole('menuitem',{name:'校验与导出'}).click();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/archive.worker.ts*',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'检查并导出配置',exact:true}).click();await expect(page.locator('.file-transfer')).toBeVisible();
  await page.getByRole('menuitem',{name:'工程总览'}).click();await page.locator('.overview-grid input').fill('new runtime snapshot');await page.locator('.overview-grid input').blur();release();
  await expect(page.getByText('工程已变化，请重新检查导出计划',{exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'运行包导出计划'})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'校验与导出'}).click();await page.getByRole('button',{name:'检查并导出配置',exact:true}).click();
  const plan=page.getByRole('dialog',{name:'运行包导出计划'});await expect(plan).toContainText('revision 1');
  const download=page.waitForEvent('download');await plan.getByRole('button',{name:'下载运行包',exact:true}).click();expect((await download).suggestedFilename().replaceAll('_',' ')).toBe('new runtime snapshot-config.zip');
});
