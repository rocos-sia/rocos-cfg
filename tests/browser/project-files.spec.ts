import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject } from '../../src/core/project/create';
import { openProject, saveProject } from '../../src/core/project/archive';
import { digest } from '../../src/core/project/types';

test('copy and independent project downloads preserve the working project and its unsaved state', async ({ page }, testInfo) => {
  const source=createProject('source','igh');
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({name:'source.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(source))});
  await page.locator('.overview-grid input').fill('edited source');
  await page.locator('.overview-grid input').blur();
  await page.getByRole('menuitem',{name:'校验与导出'}).click();
  await expect(page.locator('.save-state')).toHaveText('草稿已缓存；工程文件未保存');
  const outputs=[];
  for(const action of ['导出工程副本','复制为新工程']){
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:action,exact:true}).click();
    const path=testInfo.outputPath(`${outputs.length}.rcproj`);
    await (await download).saveAs(path);
    outputs.push(await openProject(await readFile(path)));
    await expect(page.locator('.project-name strong')).toHaveText('edited source');
    await expect(page.locator('.save-state')).toHaveText('草稿已缓存；工程文件未保存');
  }
  expect(outputs[0].id).toBe(source.id);expect(outputs[1].id).not.toBe(source.id);
  expect(outputs[0].snapshotId).not.toBe(outputs[1].snapshotId);
  expect(outputs[1].name).toBe('edited source（副本）');expect(outputs[1].revision).toBe(0);
  expect(outputs[1].files).toEqual(outputs[0].files);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('current.rcproj');await (await download).saveAs(path);
  const saved=await openProject(await readFile(path));expect(saved.id).toBe(source.id);expect(saved.name).toBe('edited source');
  await expect(page.locator('.save-state')).toHaveText('已生成工程下载');
});

test('opening another snapshot of the same UUID explains replacement and refreshes all project fields',async({page})=>{
  const p=createProject('first snapshot','igh');p.description='first description';
  await page.goto('/');
  const select=async()=>page.locator('input[type=file]').first().setInputFiles({name:'snapshot.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await select();await expect(page.locator('.overview-grid input')).toHaveValue('first snapshot');
  p.name='second snapshot';p.description='second description';p.revision=7;
  await select();
  const dialog=page.getByRole('dialog',{name:'切换工程'});
  await expect(dialog).toContainText('同一工程的另一份文件');
  await expect(dialog).toContainText('second snapshot · revision 7');
  await dialog.getByRole('button',{name:'打开新工程',exact:true}).click();
  await expect(page.locator('.project-name strong')).toHaveText('second snapshot');
  await expect(page.locator('.overview-grid input')).toHaveValue('second snapshot');
  await expect(page.locator('.overview-grid textarea')).toHaveValue('second description');
});

test('same-UUID copies retain independent recovery drafts after a fresh tab and restore unapplied source',async({page,context},testInfo)=>{
  const p=createProject('first recovery copy','igh');
  p.editor.buffers[p.entrypoints.master.fileId!]={text:'invalid: [',baseHash:await digest(p.files[0].bytes)};
  await page.goto('/');
  const select=async()=>page.locator('input[type=file]').first().setInputFiles({name:'copy.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await select();
  await page.locator('.overview-grid input').fill('unsaved first branch');await page.locator('.overview-grid input').blur();
  await expect(page.locator('.save-state')).toHaveText('草稿已缓存；工程文件未保存');
  p.name='second recovery copy';await select();
  await page.getByRole('dialog',{name:'切换工程'}).getByRole('button',{name:'打开新工程',exact:true}).click();
  await page.locator('.overview-grid input').fill('unsaved second branch');await page.locator('.overview-grid input').blur();
  await expect(page.locator('.save-state')).toHaveText('草稿已缓存；工程文件未保存');
  const fresh=await context.newPage();await fresh.goto('/');
  const recovery=fresh.getByRole('dialog',{name:'本机恢复草稿'});
  await expect(recovery).toBeVisible();
  const first=recovery.getByRole('row').filter({hasText:'unsaved first branch'}),second=recovery.getByRole('row').filter({hasText:'unsaved second branch'});
  await expect(first).toBeVisible();await expect(second).toBeVisible();
  await first.getByRole('button',{name:'恢复草稿',exact:true}).click();
  await expect(fresh.locator('.project-name strong')).toHaveText('unsaved first branch');
  const download=fresh.waitForEvent('download');await fresh.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('recovered.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));
  expect(restored.id).toBe(p.id);expect(restored.editor.buffers).toEqual(p.editor.buffers);expect(restored.files).toEqual(p.files);
  await fresh.getByRole('button',{name:'本机恢复草稿',exact:true}).click();
  await expect(recovery.getByRole('row').filter({hasText:'unsaved second branch'})).toBeVisible();
  await recovery.getByRole('row').filter({hasText:'unsaved second branch'}).getByRole('button',{name:'清除草稿',exact:true}).click();
  await fresh.getByRole('tooltip').getByRole('button',{name:'确认清除',exact:true}).click();
  await expect(recovery.getByRole('row').filter({hasText:'unsaved second branch'})).toHaveCount(0);
  await fresh.close();
});
