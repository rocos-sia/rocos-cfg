import { expect, test } from '@playwright/test';
import { createExample } from '../../src/core/project/examples';
import { saveProject } from '../../src/core/project/archive';
import { buildBusCatalog } from '../../src/core/bus/catalog';
import { editProjectYaml, masterFileId } from '../../src/core/bus/igh-edit';
import { projectSnapshot } from './helpers/project';

for (const kind of ['igh', 'ecm'] as const) test(`${kind} process image groups Rx and Tx without changing signal order, offsets or project`, async ({ page }, info) => {
  const p = createExample(kind);
  if (kind === 'igh') editProjectYaml(p, masterFileId(p), doc => {
    const slave = doc.toJS().slaves[0];
    doc.setIn(['slaves', 1], doc.createNode({ ...slave, id: 1, dc_ref: false }));
    doc.setIn(['slaves', 1, 'rx_pdos', 1], { index: 0x1601, entries: [] });
  });
  const catalog = buildBusCatalog(p);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'process.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await page.getByRole('menuitem', { name: '主站配置', exact: true }).click();
  await expect(page.getByText(/运行时待发现/)).toHaveCount(0);
  await page.getByRole('tab', { name: /^过程映像/ }).click();
  const before = await projectSnapshot(page);
  const group = page.getByRole('radio', { name: '按 Rx / Tx 分组', exact: true });
  await group.focus(); await page.keyboard.press('Space');
  await expect(group).toBeChecked();
  for (const [direction, label] of [['output', '输出 Rx'], ['input', '输入 Tx']] as const) {
    const section = page.getByRole('region', { name: label, exact: true });
    const rows = section.locator('tbody tr.ant-table-row');
    const expected = catalog.signals.filter(s => s.direction === direction).slice(0, 10);
    await expect(rows).toHaveCount(expected.length);
    for (const [i, signal] of expected.entries()) {
      await expect(rows.nth(i).locator('td').nth(0)).toHaveText(String(signal.slaveId));
      await expect(rows.nth(i).locator('td').nth(2)).toHaveText(signal.runtimeName);
      await expect(rows.nth(i).locator('td').nth(4)).toHaveText(String(signal.bitOffset ?? '—'));
    }
  }
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('process-groups.png'), fullPage: true });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('排列方式', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('process-groups-dark-narrow.png') });
  await page.getByText('原始顺序', { exact: true }).click();
  await expect(page.getByRole('radio', { name: '原始顺序', exact: true })).toBeChecked();
  expect(await projectSnapshot(page)).toBe(before);
  if (kind === 'igh') {
    await page.getByRole('tab', { name: 'PDO / SDO 编辑', exact: true }).click();
    await expect(page.getByText(/运行时待发现/)).toHaveCount(0);
  }
});
