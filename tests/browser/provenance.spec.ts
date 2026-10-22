import { uiOrigin } from './helpers/origin';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { targetStatus } from '../../src/core/project/profiles';
import { resourceProject } from '../fixtures/resources';

test('robot template parameters and immutable snapshots survive a fresh-context archive reopening',async({page,browser},testInfo)=>{
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建配置工程'});
  await dialog.locator('.ant-select[aria-label="初始模型模板"]').click();await page.getByTitle('双关节演示模型',{exact:true}).click();
  await dialog.getByLabel('模型名称前缀',{exact:true}).fill('lab');await dialog.getByLabel('模板连杆长度',{exact:true}).fill('0.45');
  await dialog.getByRole('button',{name:'创建工程',exact:true}).click();
  await expect(page.getByText('快照已核对',{exact:true})).toHaveCount(2);
  const row=page.getByRole('row').filter({hasText:'robot.two-axis v1'});await expect(row).toContainText('0.45');
  await row.getByRole('button',{name:'查看模板快照'}).click();
  const preview=page.getByRole('dialog',{name:'规则与模板快照 · 只读'});await expect(preview).toContainText('教学模型');
  await preview.getByRole('button',{name:'关闭预览'}).click();
  await page.getByRole('menuitem',{name:'机器人模型'}).click();await expect(page.locator('.model-tree')).toContainText('lab_joint_2');
  await page.screenshot({path:testInfo.outputPath('template-robot.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('template.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(restored.editor.templateUses?.find(t=>t.templateId==='robot.two-axis')?.overrides).toEqual({prefix:'lab',linkLength:0.45});
  const context=await browser.newContext(),fresh=await context.newPage();await fresh.goto(uiOrigin);await fresh.locator('input[type=file]').first().setInputFiles(path);
  await expect(fresh.getByRole('row').filter({hasText:'robot.two-axis v1'})).toContainText('0.45');
  await fresh.getByRole('menuitem',{name:'机器人模型'}).click();await expect(fresh.locator('.model-tree')).toContainText('lab_joint_2');await context.close();
});

test('altered rule snapshots block automatic master editing until explicit retargeting preserves the old snapshot',async({page},testInfo)=>{
  const p=resourceProject(),profile=fileById(p,p.targets.master.profile!.fileId)!;
  const data=JSON.parse(textOf(profile));data.rules.maxSlaves=500;profile.bytes=utf8.encode(JSON.stringify(data));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'rules.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.getByText('不受支持',{exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'主站配置'}).click();await expect(page.getByText('请在工程总览核对目标规则。',{exact:false})).toBeVisible();
  await expect(page.getByRole('spinbutton',{name:/^通信周期/})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'工程总览'}).click();await page.getByRole('button',{name:'改用内置规则',exact:true}).click();
  await page.getByRole('dialog',{name:'确认目标规则'}).getByRole('button',{name:'使用此规则'}).click();
  await expect(page.getByText('快照已核对',{exact:true})).toHaveCount(2);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('retargeted.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  expect(targetStatus(restored,'master').supported).toBe(true);expect(restored.targets.master.profile?.fileId).not.toBe(profile.id);
  expect(fileById(restored,profile.id)?.bytes).toEqual(profile.bytes);expect(restored.editor.confirmations).toEqual({});
});
