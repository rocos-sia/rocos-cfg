import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openProject } from '../../src/core/project/archive';
import { fileById, textOf } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';
import { validateTemplates } from '../../src/core/project/templates';

const choose = async (page: import('@playwright/test').Page, label: string) => {
  const select = page.locator('.ant-select[aria-label="PDO 模板"]:visible');
  await select.click(); await select.getByRole('combobox').fill(label);
  await page.locator('.ant-select-dropdown:visible').getByTitle(label, { exact: true }).click();
};
test('brand/model templates seed new masters, append through both controls, undo and survive an archive', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await choose(page, 'Elmo · Twitter · Talon');
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('menuitem', { name: '主站配置', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Elmo Twitter Drive', exact: true })).toBeVisible();
  await choose(page, 'XJC · 型号未注明 · ZeroErr6');
  await page.getByRole('button', { name: '新增从站', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'XJC FT Sensor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'XJC FT Sensor', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await choose(page, '品牌未注明 · AX58200 GPIO · 16DI / 16DO');
  await page.getByRole('tab', { name: 'PDO / SDO 编辑', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'PDO / SDO 编辑', exact: true }).getByRole('button', { name: '新增从站', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'RxPDO 1 条目 1 名称', exact: true })).toHaveValue('RxPDO_1600_01');
  await expect(page.getByLabel('RxPDO 1 条目 1 位宽', { exact: true })).toHaveValue('1');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const path = info.outputPath('templates.rcproj'); await (await download).saveAs(path);
  const p = await openProject(await readFile(path)), config = readYaml(textOf(fileById(p, p.entrypoints.master.fileId)!));
  expect(config.slaves.map((s: {name:string})=>s.name)).toEqual(['Elmo Twitter Drive','XJC FT Sensor','AX58200 GPIO']);
  expect(config.slaves[2].tx_pdos[0].entries).toHaveLength(16); expect(validateTemplates(p)).toEqual([]);
  expect(p.editor.templateUses!.map(use=>use.templateId)).toEqual(expect.arrayContaining(['device.igh-drive-talon','device.igh-ft-xjc','device.igh-io-ax58200']));
  await page.getByRole('tab', { name: /^从站/ }).click();
  await page.screenshot({ path: info.outputPath('pdo-templates.png'), fullPage: true });
});
test('ECM hides the PDO library and blank IGH projects stay empty', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('dialog').locator('.ant-select[aria-label="主站类型"]').click(); await page.getByTitle('ROCOS-ECM', { exact: true }).click();
  await expect(page.locator('.ant-select[aria-label="PDO 模板"]')).toHaveCount(0);
  await page.getByRole('dialog').locator('.ant-select[aria-label="主站类型"]').click(); await page.getByTitle('ROCOS-IGH', { exact: true }).click();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('menuitem', { name: '主站配置', exact: true }).click();
  await expect(page.getByRole('tab', { name: '从站 (0)', exact: true })).toBeVisible();
});
