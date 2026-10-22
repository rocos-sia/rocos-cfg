import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { saveProject } from '../../src/core/project/archive';
import { createExample } from '../../src/core/project/examples';
import { fileById, textOf, utf8, type Project } from '../../src/core/project/types';
import { editProjectYaml, masterFileId, planSlaveChange } from '../../src/core/bus/igh-edit';
import { previewProject } from '../fixtures/preview';
import { projectSnapshot } from './helpers/project';
import { assertBundledFonts } from './helpers/fonts';

async function open(page: Page, p: Project, route: string) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'compact.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await page.getByRole('menuitem', { name: route, exact: true }).click();
}
async function fileText(page: Page, id: string) {
  const p = JSON.parse(await projectSnapshot(page));
  return new TextDecoder().decode(new Uint8Array(Object.values(p.files.find((f: { id: string }) => f.id === id).bytes)));
}
function slavesProject() {
  let p = createExample('igh');
  while (parse(textOf(fileById(p, masterFileId(p))!)).slaves.length < 3) p = planSlaveChange(p, { kind: 'add' }).project;
  editProjectYaml(p, masterFileId(p), doc => { for (let i = 0; i < 3; i++) doc.setIn(['slaves', i, 'name'], `Drive ${i}`); });
  return p;
}

test('slave row drag and trash review remap bindings, update topology, and undo restores files', async ({ page }, info) => {
  const p = slavesProject(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, p, '主站配置');
  const nodes = page.locator('.bus-topology .react-flow__node');
  await expect(nodes).toHaveCount(4);
  await assertBundledFonts(page);
  await page.locator('.slave-table').scrollIntoViewIfNeeded();
  const initial = await fileText(page, masterFileId(p));
  const rows = page.locator('.slave-table tbody tr.ant-table-row');
  await rows.nth(0).dragTo(rows.nth(2));
  const dialog = page.getByRole('dialog', { name: '确认从站及绑定变更', exact: true });
  await expect(dialog).toContainText('Slave 0 → Slave 2');
  await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
  expect(await fileText(page, masterFileId(p))).toBe(initial);
  await rows.nth(0).dragTo(rows.nth(2));
  await dialog.getByRole('button', { name: '应用变更', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="slave-2"]')).toContainText('Drive 0');
  expect(parse(await fileText(page, masterFileId(p))).slaves.map((s: { name: string }) => s.name)).toEqual(['Drive 1', 'Drive 2', 'Drive 0']);
  expect(parse(await fileText(page, p.entrypoints.hardware!)).hardware[0].id).toBe(2);
  expect(parse(await fileText(page, p.entrypoints.binding!)).joint_bindings[0].drive_id).toBe(2);
  await page.getByRole('button', { name: '删除从站 2', exact: true }).click();
  await expect(dialog).toContainText('移除 joint_bindings');
  await dialog.getByRole('button', { name: '应用变更', exact: true }).click();
  await expect(nodes).toHaveCount(3); await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(nodes).toHaveCount(4);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await fileText(page, masterFileId(p))).toBe(initial);
  // Keyboard/single-pointer alternative to dragging.
  await page.getByRole('button', { name: '下移从站 0', exact: true }).focus(); await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: '应用变更', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="slave-1"]')).toContainText('Drive 0');
  await page.locator('.bus-topology-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('igh-topology.png') });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('.bus-topology .react-flow')).toHaveClass(/dark/);
  await page.screenshot({ path: info.outputPath('igh-topology-dark.png') }); expect(errors).toEqual([]);
});

test('ECM topology remains read-only and ENI bytes remain unchanged', async ({ page }) => {
  const p = createExample('ecm'); await open(page, p, '主站配置');
  await expect(page.locator('.bus-topology .react-flow__node')).toHaveCount(2);
  await expect(page.getByText('按 ENI 从站顺序展示，只读；此顺序视图不推断物理端口分支。', { exact: true })).toBeVisible();
  await expect(page.locator('.slave-table button')).toHaveCount(0);
  expect(await fileText(page, p.entrypoints.master.eniFileId!)).toBe(textOf(fileById(p, p.entrypoints.master.eniFileId)!));
});

test('URDF formatting creates a readable draft, applies explicitly, and rejects invalid input', async ({ page }) => {
  const p = previewProject(), file = fileById(p, p.entrypoints.urdf)!;
  const hardware = "<hardware legacy='yes'>  preserve <unknown/> </hardware>";
  file.bytes = utf8.encode(textOf(file).replace(/\n/g, '').replace('</robot>', hardware + '</robot>'));
  await open(page, p, '机器人模型');
  const source = page.getByRole('textbox', { name: '配置源码', exact: true });
  await page.getByRole('button', { name: '格式化 URDF', exact: true }).click();
  await expect(page.getByRole('button', { name: '放弃草稿', exact: true })).toBeVisible();
  expect(await fileText(page, file.id)).toBe(textOf(file));
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  const formatted = await fileText(page, file.id);
  expect(formatted).toContain('\n  <link name="base_link">\n    <visual>'); expect(formatted).toContain(hardware);
  await source.fill('<robot><link></robot>');
  await page.getByRole('button', { name: '格式化 URDF', exact: true }).click();
  await expect(page.locator('.ant-message-error')).toBeVisible();
  await expect(source).toHaveText('<robot><link></robot>'); expect(await fileText(page, file.id)).toBe(formatted);
});

test('preview canvas fills the card behind compact gradients, with reachable controls on narrow screens', async ({ page }, info) => {
  await open(page, previewProject(), '机器人模型');
  const canvas = page.locator('.robot-preview canvas'); await expect(canvas).toBeVisible();
  const card = (await page.locator('.preview-card').boundingBox())!, bounds = (await canvas.boundingBox())!;
  expect(Math.abs(bounds.height - card.height)).toBeLessThan(5); expect(Math.abs(bounds.width - card.width)).toBeLessThan(5);
  expect(await page.locator('.preview-controls').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await page.screenshot({ path: info.outputPath('compact-preview.png') });
  await page.getByRole('button', { name: '展开视图', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ant-select[aria-label="模型显示"]').click();
  await page.getByTitle('碰撞（Collision）', { exact: true }).click();
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
  await page.getByRole('slider', { name: '关节预览位置', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.getByRole('slider', { name: '关节预览位置', exact: true })).toHaveAttribute('aria-valuenow', '1');
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-preview-narrow.png') });
});
