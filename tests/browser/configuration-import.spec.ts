import { expect, test, type FileChooser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProject } from '../../src/core/project/create';
import { configuration, enableSimulation } from '../../src/core/project/configuration';
import { saveProject } from '../../src/core/project/archive';
import { fileById, textOf, type Project } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';
import { collectReferences } from '../../src/core/project/references';
import { projectSnapshot } from './helpers/project';

const current = async (page: Page): Promise<Project> => {
  const project: Project = JSON.parse(await projectSnapshot(page));
  project.files.forEach(file => { file.bytes = Uint8Array.from(Object.values(file.bytes)); });
  return project;
};
const yaml = (project: Project, id: string | null | undefined) => readYaml(textOf(fileById(project, id)!));
async function pick(page: Page, name: string, input: Parameters<FileChooser['setFiles']>[0]) {
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name, exact: true }).click();
  await (await chooser).setFiles(input);
}
async function confirm(page: Page) {
  const dialog = page.getByRole('dialog', { name: '导入预览', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('bus import menu separates ECM and IGH, rejects wrong files, previews and supports undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入已有配置', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '总线配置', exact: true }).click();
  const before = await projectSnapshot(page);
  await pick(page, '导入 IGH 配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('eni: network.xml') });
  await expect(page.getByText('未找到所选类型的配置文件：igh', { exact: false })).toBeVisible();
  expect(await projectSnapshot(page)).toBe(before);
  await pick(page, '导入 ECM 配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('eni: network.xml\nid: 12\ncycle: 2000') });
  const preview = page.getByRole('dialog', { name: '导入预览', exact: true });
  await expect(preview).toBeVisible();
  expect(await projectSnapshot(page)).toBe(before);
  await preview.getByRole('button', { name: /取\s*消/ }).click();
  expect(await projectSnapshot(page)).toBe(before);
  await pick(page, '导入 ECM 配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('eni: network.xml\nid: 12\ncycle: 2000') });
  await confirm(page);
  await expect(page.getByRole('tab', { name: 'ECM', exact: true })).toHaveAttribute('aria-selected', 'true');
  let project = await current(page);
  expect(yaml(project, project.entrypoints.master.fileId).id).toBe(12n);
  await pick(page, '导入 IGH 配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('version: 1\nmaster: {master_id: 9, period_us: 1000}\nslaves: []') });
  await confirm(page);
  await expect(page.getByRole('tab', { name: 'IGH', exact: true })).toHaveAttribute('aria-selected', 'true');
  project = await current(page);
  expect(yaml(project, project.entrypoints.master.fileId).master.master_id).toBe(9n);
  expect(yaml(project, configuration(project).masters.ecm!.entry.fileId).id).toBe(12n);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'ECM', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('application and simulation menus import folders and associate their configuration files', async ({ page }, info) => {
  const robot = info.outputPath('robot'), model = info.outputPath('mjcf');
  await mkdir(join(robot, 'meshes'), { recursive: true });
  await mkdir(join(model, 'parts'), { recursive: true });
  await writeFile(join(robot, 'arm.urdf'), '<robot name="imported"><link name="base"><visual><geometry><mesh filename="meshes/part.stl"/></geometry></visual></link></robot>');
  await writeFile(join(robot, 'meshes', 'part.stl'), 'solid part\nendsolid part');
  await writeFile(join(robot, 'other.yaml'), 'eni: unrelated.xml');
  await writeFile(join(model, 'scene.xml'), '<mujoco><include file="parts/arm.xml"/></mujoco>');
  await writeFile(join(model, 'parts', 'arm.xml'), '<mujocoinclude><worldbody/></mujocoinclude>');
  const original = createProject('typed imports', 'igh'); enableSimulation(original);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'typed.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(original)) });
  await page.getByRole('menuitem', { name: '应用配置', exact: true }).click();
  await pick(page, '导入 URDF 文件夹', robot); await confirm(page);
  let project = await current(page);
  expect(project.entrypoints.master).toEqual(original.entrypoints.master);
  expect(fileById(project, project.entrypoints.urdf)?.path).toBe('models/arm.urdf');
  expect(collectReferences(project).find(r => r.field === 'robot.urdf')?.targetFileId).toBe(project.entrypoints.urdf);
  await page.getByRole('tab', { name: '硬件', exact: true }).click();
  await pick(page, '导入硬件配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('hardware: []') }); await confirm(page);
  project = await current(page);
  expect(project.entrypoints.hardware).toBe(original.entrypoints.hardware);
  await page.getByRole('tab', { name: '负载', exact: true }).click();
  await pick(page, '导入负载配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('mass: 2.5\ncom: [0, 0, 0.1]') }); await confirm(page);
  project = await current(page);
  expect(yaml(project, project.entrypoints.app).robot.payload).toBe('payloads/config.yaml');
  await expect(page.getByRole('button', { name: 'app/payloads/config.yaml', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '仿真配置', exact: true }).click();
  await pick(page, '导入 MJCF 文件夹', model); await confirm(page);
  project = await current(page);
  expect(yaml(project, configuration(project).simulationFileId).model).toBe('models/scene.xml');
  expect(collectReferences(project).find(r => r.field === 'include[0].file')?.state).toBe('internal');
  await pick(page, '导入仿真配置', { name: 'config.yaml', mimeType: 'text/yaml', buffer: Buffer.from('model: models/scene.xml\nhardware_config: hardware_config.yaml\nduration_sec: 42\nvisualize: false') }); await confirm(page);
  project = await current(page);
  expect(yaml(project, configuration(project).simulationFileId).duration_sec).toBe(42n);
  await page.getByRole('button', { name: '切换语言', exact: true }).click();
  await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Import MJCF folder', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Import simulation configuration', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('simulation-import-menu.png') });
});
