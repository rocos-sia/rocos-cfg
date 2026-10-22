import { expect, test } from '@playwright/test';
import { createProject } from '../../src/core/project/create';
import { saveProject } from '../../src/core/project/archive';
import { previewProject } from '../fixtures/preview';
import { projectSnapshot } from './helpers/project';

test('master parameters expose localized hover, focus and dismissible help without changing configuration', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name:'help.rcproj', mimeType:'application/zip', buffer:Buffer.from(await saveProject(createProject('help','ecm'))) });
  await page.getByRole('menuitem', { name:'主站配置', exact:true }).click();
  const fields=page.locator('.fields .field'), before=await projectSnapshot(page);
  for (const field of await fields.all()) await expect(field.locator('.parameter-help')).toHaveCount(1);
  const help=page.getByRole('button',{ name:'参数说明：通信周期', exact:true });
  await help.hover(); await expect(page.getByRole('tooltip')).toContainText('单位 μs');
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).not.toBeVisible();
  await page.mouse.move(0,0); await help.focus(); await expect(page.getByRole('tooltip')).toContainText('单位 μs');
  await help.press('Escape'); await expect(page.getByRole('tooltip')).not.toBeVisible(); await expect(help).toBeFocused();
  await help.blur(); await help.click(); await expect(page.getByRole('tooltip')).toContainText('EtherCAT');
  await help.press('Escape');
  await page.getByRole('button',{name:'切换语言',exact:true}).click(); await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'Parameter help: Communication cycle',exact:true}).focus();
  await expect(page.getByRole('tooltip')).toContainText('EtherCAT communication interval');
  expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({path:info.outputPath('master-help.png')});
});

test('compact robot toolbar shares a row on desktop and wraps without hiding actions on narrow screens', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name:'robot.rcproj', mimeType:'application/zip', buffer:Buffer.from(await saveProject(previewProject())) });
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  const before=await projectSnapshot(page), add=page.getByRole('button',{name:'新增关节与 Link',exact:true}), reset=page.getByRole('button',{name:'重置面板布局',exact:true});
  await expect(page.locator('.model-workspace-shell')).toHaveAttribute('data-mode','wide');
  expect(Math.abs((await add.boundingBox())!.y-(await reset.boundingBox())!.y)).toBeLessThan(2);
  const heading=(await page.locator('.robot-page-heading').boundingBox())!, grid=(await page.locator('.robot-workspace').boundingBox())!;
  expect(grid.y-heading.y-heading.height).toBeLessThan(90);
  await page.getByText('joint_1 [revolute]',{exact:true}).click();
  for(const field of await page.locator('.model-pane-properties .field').all()) await expect(field.locator('.parameter-help')).toHaveCount(1);
  await page.getByRole('button',{name:'参数说明：位置上限',exact:true}).focus(); await expect(page.getByRole('tooltip')).toContainText('独立于 Hardware 限位');
  await page.keyboard.press('Escape'); await page.screenshot({path:info.outputPath('robot-compact.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(add).toBeVisible(); await expect(reset).toBeVisible();
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
  expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({path:info.outputPath('robot-narrow.png')});
});
