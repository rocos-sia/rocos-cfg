import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { readRobot } from '../../src/core/documents/urdf';

test('model editor ignores legacy hardware and preserves it on export',async({page},info)=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.urdf)!;
  file.bytes=utf8.encode(textOf(file).replace('</joint>','<hardware><limit upper="0.75" vel="2"/></hardware></joint>'));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'limits.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'机器人模型'}).click();await page.getByText('joint [revolute]',{exact:true}).click();
  const notice=page.locator('.ant-alert').filter({hasText:'APP 模型有效限位'});
  await expect(notice).toHaveCount(0);
  const upper=page.getByRole('textbox',{name:'位置上限',exact:true});await expect(upper).toHaveValue('1');await upper.fill('1.5');await upper.blur();
  await expect(notice).toHaveCount(0);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('limits.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path)),joint=readRobot(textOf(fileById(restored,restored.entrypoints.urdf)!)).joints[0];
  expect(joint.upper).toBe('1.5');expect(joint.velocity).toBe('1');
  expect(textOf(fileById(restored,restored.entrypoints.urdf)!)).toContain('<hardware><limit upper="0.75" vel="2"/></hardware>');
});
