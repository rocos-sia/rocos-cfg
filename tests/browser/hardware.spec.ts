import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { patchYaml } from '../../src/core/documents/yaml';
import { bindingDocument, hardwareDocument } from '../../src/core/hardware/schema';

test('mechanical edits invalidate approval, undo restores it, device deletion synchronizes binding and can be undone',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'hardware.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(resourceProject()))});
  await page.getByRole('menuitem',{name:'硬件与绑定'}).click();
  const approval=page.getByRole('checkbox',{name:'已人工核对换算、零点与限位'});
  await expect(approval).toBeChecked();await page.getByRole('spinbutton',{name:'ratio',exact:true}).fill('2');await page.getByRole('spinbutton',{name:'ratio',exact:true}).blur();
  await expect(approval).not.toBeChecked();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(approval).toBeChecked();
  await page.getByRole('button',{name:'删除设备',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'确认硬件变更'});
  await expect(confirmation).toContainText('joint：移除绑定');await confirmation.getByRole('button',{name:'应用变更'}).click();
  await expect(page.getByRole('button',{name:'删除设备',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(approval).toBeChecked();
  await page.screenshot({path:info.outputPath('hardware-review.png'),fullPage:true});expect(errors).toEqual([]);
});

test('builds a reviewable driver draft from an explicit joint and slave choice and saves it without inventing mechanics',async({page},info)=>{
  const p=resourceProject();for(const [id,key] of [[p.entrypoints.hardware,'hardware'],[p.entrypoints.binding,'joint_bindings']] as const){const f=fileById(p,id)!;f.bytes=utf8.encode(patchYaml(textOf(f),[key],[]));}p.editor.confirmations={};
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'empty-hardware.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'硬件与绑定'}).click();await page.getByRole('button',{name:'新增 driver',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'新增 driver'});
  await modal.getByLabel('目标从站',{exact:true}).click();await page.getByText('Slave 0 · Drive',{exact:true}).click();
  await modal.getByLabel('控制关节（可稍后绑定）',{exact:true}).click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('joint',{exact:true}).click();
  await modal.getByRole('button',{name:'预览配置草稿'}).click();const preview=page.getByRole('dialog',{name:'确认硬件变更'});
  await expect(preview).toContainText('joint → Drive 0 → Slave 0');await expect(preview).toContainText('换算比例、零点');await preview.getByRole('button',{name:'应用变更'}).click();
  await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toHaveValue('');await expect(page.getByRole('spinbutton',{name:'lower',exact:true})).toHaveValue('-1');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const path=info.outputPath('draft.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path)),d=hardwareDocument(fileById(restored,restored.entrypoints.hardware)!).devices[0];
  expect(d.transform.ratio).toBeNull();expect(d.inputs.status_word).toBe('status_word');expect(d.limit.acc).toBeNull();
  expect(bindingDocument(fileById(restored,restored.entrypoints.binding)!).bindings).toEqual([{joint_name:'joint',drive_id:0}]);
});

test('missing binding files show consumer-derived order and create an explicit file only after review',async({page},info)=>{
  const p=resourceProject();p.entrypoints.binding=null;
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'legacy.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'硬件与绑定'}).click();
  await expect(page.getByText('缺少显式绑定文件',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'预览并生成显式绑定'}).click();const preview=page.getByRole('dialog',{name:'确认硬件变更'});
  await expect(preview).toContainText('Hardware YAML 中 Driver 的顺序');await preview.getByRole('button',{name:'应用变更'}).click();
  await expect(page.getByText('缺少显式绑定文件',{exact:true})).toHaveCount(0);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const path=info.outputPath('explicit.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(bindingDocument(fileById(restored,restored.entrypoints.binding)!).bindings).toEqual([{joint_name:'joint',drive_id:0}]);
});

test('shows the consumer value of octal mechanical parameters and keeps it after a different form edit',async({page},info)=>{
  const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
  f.bytes=utf8.encode(textOf(f).replace('offset_pos_cnt: 0','offset_pos_cnt: 010'));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'native-numbers.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'硬件与绑定'}).click();
  await expect(page.getByRole('spinbutton',{name:'offset_pos_cnt',exact:true})).toHaveValue('8');
  await page.getByRole('spinbutton',{name:'ratio',exact:true}).fill('2');await page.getByRole('spinbutton',{name:'ratio',exact:true}).blur();
  await expect(page.getByRole('spinbutton',{name:'offset_pos_cnt',exact:true})).toHaveValue('8');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const path=info.outputPath('native-numbers.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(hardwareDocument(fileById(restored,restored.entrypoints.hardware)!).devices[0].transform.offset_pos_cnt).toBe(8);
});
