import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { createProject, makeFile } from '../../src/core/project/create';
import { openProject, saveProject } from '../../src/core/project/archive';
import { packZip, unpackZip } from '../../src/core/project/zip';
import { utf8 } from '../../src/core/project/types';

test('damaged archives remain separate until explicit recovery and exact original copying preserves their bytes',async({page},testInfo)=>{
  const p=createProject('damaged archive','igh'),good=makeFile('assets/notes.txt','attachment','verified notes');p.files.push(good);
  const entries=unpackZip(await saveProject(p));entries.set('master/igh.yaml',utf8.encode('tampered master'));const broken=packZip(entries);
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
  await page.locator('input[type=file]').first().setInputFiles({name:'damaged.rcproj',mimeType:'application/zip',buffer:Buffer.from(broken)});
  const dialog=page.getByRole('dialog',{name:'工程完整性检查失败'});
  await expect(dialog).toBeVisible();await expect(page.locator('.project-name strong')).toHaveText('我的机器人');
  const copied=page.waitForEvent('download');await dialog.getByRole('button',{name:'复制原始工程包',exact:true}).click();
  const original=testInfo.outputPath('original.rcproj');await(await copied).saveAs(original);expect(new Uint8Array(await readFile(original))).toEqual(broken);
  await dialog.getByRole('button',{name:'检查可恢复文件',exact:true}).click();
  await expect(dialog.getByRole('row').filter({hasText:'master/igh.yaml'})).toContainText('损坏');
  await expect(page.locator('.project-name strong')).toHaveText('我的机器人');
  await page.screenshot({path:testInfo.outputPath('archive-recovery-preview.png'),fullPage:true});
  await dialog.getByRole('button',{name:'创建恢复工程',exact:true}).click();
  await page.getByRole('dialog',{name:'切换工程'}).getByRole('button',{name:'打开新工程',exact:true}).click();
  await expect(page.locator('.project-name strong')).toHaveText('damaged archive（恢复）');
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const output=testInfo.outputPath('recovered.rcproj');await(await downloaded).saveAs(output);
  const restored=await openProject(await readFile(output));expect(restored.id).not.toBe(p.id);expect(restored.entrypoints.master.fileId).toBeNull();
  expect(restored.files.some(f=>f.path==='master/igh.yaml')).toBe(false);expect(restored.files.find(f=>f.id===good.id)?.bytes).toEqual(good.bytes);
  expect(restored.files.some(f=>f.path.endsWith('/report.json'))).toBe(true);
  await page.getByRole('button',{name:'校验工程',exact:true}).click();await page.getByRole('button',{name:'检查并导出配置',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'运行包导出计划'})).toHaveCount(0);
});

test('unsafe archives cannot enter recovery and dismissing the preview preserves the active project',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
  const unsafe=zipSync({'../escape':utf8.encode('not a project')});
  await page.locator('input[type=file]').first().setInputFiles({name:'unsafe.rcproj',mimeType:'application/zip',buffer:Buffer.from(unsafe)});
  const dialog=page.getByRole('dialog',{name:'工程完整性检查失败'});await dialog.getByRole('button',{name:'检查可恢复文件',exact:true}).click();
  await expect(dialog).toContainText('无法安全恢复');await expect(dialog.getByRole('button',{name:'创建恢复工程'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'保留当前工作区'}).click();await expect(page.locator('.project-name strong')).toHaveText('我的机器人');
});
