import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { createExample } from '../../src/core/project/examples';
import { saveProject } from '../../src/core/project/archive';
import { fileById, utf8 } from '../../src/core/project/types';
import { malformedRobot } from '../fixtures/malformed-robot';
import { activate } from './helpers/input';

async function open(page: Page, source = malformedRobot) {
  const project = createExample('igh'); fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(source);
  await page.goto('/'); await page.locator('input[type=file]').first().setInputFiles({ name: 'conflicts.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(project)) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(page.getByRole('tree', { name: '机器人结构树', exact: true })).toBeVisible();
}
const snapshot = (page: Page) => page.evaluate(async () => { const path = '/src/store.ts'; const { useProject } = await import(path); return JSON.stringify(useProject.getState().project); });
const selectedLine = (page: Page) => page.evaluate(() => {
  const selection = window.getSelection(), node = selection?.anchorNode;
  return { text: selection?.toString(), line: (node instanceof Element ? node : node?.parentElement)?.closest('.cm-line')?.textContent };
});
const firstDuplicate = 'shared [Joint #2，名称冲突或为空] [fixed]', secondDuplicate = 'shared [Joint #3，名称冲突或为空] [fixed]';

test('every malformed occurrence remains selectable and ambiguous rows locate the exact source occurrence with keyboard', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const before = await snapshot(page), tree = page.getByRole('tree');
  for (const name of ['orphan [fixed]', firstDuplicate, secondDuplicate, 'cycle [fixed]', 'missing_child [fixed]', '未命名 [Joint #6，名称冲突或为空] [fixed]', 'dup [Link #3，名称冲突或为空]', 'dup [Link #4，名称冲突或为空]', '未命名 [Link #5，名称冲突或为空]']) await expect(tree.getByText(name, { exact: true })).toBeVisible();
  await expect(tree).toContainText('未连接节点 / 冲突节点'); await expect(tree).toContainText('缺少子 Link：absent'); await expect(tree).not.toContainText('opaque');
  await tree.getByText(secondDuplicate, { exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名节点', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: '删除节点', exact: true })).toBeDisabled();
  await expect(page.getByText('文件中的第 3 个 Joint', { exact: true })).toBeVisible(); await expect(page.getByText('父 Link：arm', { exact: true })).toBeVisible();
  await activate(page, page.getByRole('button', { name: '定位到 URDF 源码', exact: true }), 'keyboard');
  await expect(page.getByRole('textbox', { name: '配置源码', exact: true })).toBeFocused();
  await expect.poll(() => selectedLine(page)).toEqual({ text: '<joint', line: expect.stringContaining('occurrence="second"') });
  await tree.getByText(firstDuplicate, { exact: true }).click(); await page.getByRole('button', { name: '定位到 URDF 源码', exact: true }).click();
  await expect.poll(async () => (await selectedLine(page)).line).toContain('occurrence="first"');
  await tree.getByText('base_link [重复父节点 / 环]', { exact: true }).click();
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('base_link');
  await page.screenshot({ path: info.outputPath('conflicting-tree.png') });
  await tree.getByText(secondDuplicate, { exact: true }).click(); await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换语言', exact: true }).click(); await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('shared [Joint #3, ambiguous or empty name]');
  await expect(page.getByRole('tree', { name: 'Robot structure tree', exact: true })).toContainText('Disconnected / conflicting nodes');
  await page.getByRole('button', { name: 'Locate in URDF source', exact: true }).click();
  await expect.poll(async () => (await selectedLine(page)).line).toContain('occurrence="second"');
  expect(await snapshot(page)).toBe(before); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath('conflicting-source-dark-en.png') });
});

test('source navigation protects unapplied drafts and source repair restores the tree, preview and preserved archive bytes', async ({ page }, info) => {
  await open(page); await page.getByRole('tree').getByText(secondDuplicate, { exact: true }).click();
  await page.getByRole('button', { name: '定位到 URDF 源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '配置源码', exact: true });
  await editor.press('ControlOrMeta+Home'); await page.keyboard.insertText('<!-- pending draft -->\n');
  await expect(page.getByRole('alert').filter({ hasText: '源码草稿尚未应用' })).toBeVisible();
  const before = await snapshot(page); await page.getByRole('button', { name: '定位到 URDF 源码', exact: true }).click();
  await expect(page.getByText('源码已变化，请先应用或放弃草稿，再重新定位节点。', { exact: true })).toBeVisible(); expect(await snapshot(page)).toBe(before);
  await expect(editor).toContainText('pending draft');
  const repaired = '<robot name="repaired"><link name="base_link"/><link name="tool_link"/><joint name="joint_1" type="fixed"><parent link="base_link"/><child link="tool_link"/></joint><hardware><link name="opaque-link"/><joint name="opaque-joint"/></hardware></robot>';
  await editor.focus(); await editor.press('ControlOrMeta+A'); await page.keyboard.insertText(repaired);
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(page.getByRole('tree')).not.toContainText('冲突节点'); await expect(page.getByText('joint_1 [fixed]', { exact: true })).toBeVisible();
  await expect(page.getByLabel('机器人三维预览', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const path = info.outputPath('repaired.rcproj'); await (await download).saveAs(path);
  expect(new TextDecoder().decode(unzipSync(await readFile(path))['models/robot.urdf'])).toBe(repaired);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('tree').getByText(secondDuplicate, { exact: true })).toBeVisible();
});

test('an orphan joint can be reattached using the form and undone without dropping nodes', async ({ page }) => {
  const source = '<robot name="orphan"><link name="base_link"/><link name="tool_link"/><joint name="joint_1" type="fixed"><parent link="missing"/><child link="tool_link"/></joint></robot>';
  await open(page, source); await page.getByRole('tree').getByText('joint_1 [fixed]', { exact: true }).click();
  const parent = page.locator('.ant-select').filter({ has: page.locator('#joint-parent') });
  await expect(parent).toContainText('missing'); await parent.click();
  await page.locator('.ant-select-item-option[title="base_link"]').click();
  await expect(page.getByRole('dialog')).toContainText('missing → base_link'); await page.getByRole('button', { name: '应用模型变更', exact: true }).click();
  await expect(page.getByRole('tree')).not.toContainText('冲突节点'); await expect(page.getByLabel('机器人三维预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.getByRole('tree')).toContainText('未连接节点 / 冲突节点');
  await expect(page.getByRole('tree').getByText('joint_1 [fixed]', { exact: true })).toBeVisible();
});

test('multiple incoming joints remain visible and their reference selects the canonical child without changing data', async ({ page }) => {
  const source = '<robot name="multiple"><link name="base_link"/><link name="tool_link"/><joint name="first" type="fixed"><parent link="base_link"/><child link="tool_link"/></joint><joint name="second" type="fixed"><parent link="base_link"/><child link="tool_link"/></joint></robot>';
  await open(page, source); const before = await snapshot(page), tree = page.getByRole('tree');
  await expect(tree.getByText('first [fixed]', { exact: true })).toBeVisible(); await expect(tree.getByText('second [fixed]', { exact: true })).toBeVisible();
  await tree.getByText('tool_link [重复父节点 / 环]', { exact: true }).click();
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toHaveText('tool_link [控制链端点]');
  await expect(page.getByText('Link：tool_link', { exact: true })).toBeVisible(); expect(await snapshot(page)).toBe(before);
});
