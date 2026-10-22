import { expect, test, type Page } from '@playwright/test';
import { missingPreviewProject, axisPreviewProject } from '../fixtures/diagnostics';
import { saveProject } from '../../src/core/project/archive';
import { fileById, utf8, type Project } from '../../src/core/project/types';
import { makeFile } from '../../src/core/project/create';
import { resourceProject } from '../fixtures/resources';
import { texturedDae } from '../fixtures/textured-dae';

async function open(page: Page, project: Project) {
  await page.goto('/'); await page.locator('input[type=file]').first().setInputFiles({ name: 'diagnostics.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(project)) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  await expect(page.locator('.robot-preview canvas')).toBeVisible(); await page.getByRole('button', { name: '适应模型', exact: true }).click();
}
const snapshot = (page: Page) => page.evaluate(async () => { const path = '/src/store.ts'; const { useProject } = await import(path); return JSON.stringify(useProject.getState().project); });
async function orangePixels(page: Page, blue = false) {
  const png = await page.locator('.robot-preview canvas').screenshot();
  return page.evaluate(async ({ base64, blue }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let i = 0; i < data.length; i += 4) if (blue ? data[i] > 20 && data[i] < 100 && data[i + 1] > 50 && data[i + 1] < 160 && data[i + 2] > 170 : data[i] > 160 && data[i + 1] > 55 && data[i + 1] < 175 && data[i + 2] < 70) count++;
    return count;
  }, { base64: png.toString('base64'), blue });
}
test('missing mesh inventory locates visual/collision placeholders, ignores legacy hardware and preserves the project', async ({ page }, info) => {
  const project = missingPreviewProject(), external: string[] = [];
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5173')) external.push(r.url()); });
  await open(page, project); const before = await snapshot(page), problems = page.getByRole('region', { name: '模型资源问题', exact: true });
  await expect(problems.locator('li')).toHaveCount(3); await expect(problems).not.toContainText('opaque-');
  await expect(problems).toContainText('missing-a.stl'); await expect(problems).toContainText('missing-b.dae'); await expect(problems).toContainText('https://example.invalid/remote.stl');
  await expect.poll(() => orangePixels(page)).toBeGreaterThan(30);
  await problems.getByRole('button', { name: '定位 tool_link · 碰撞（Collision）', exact: true }).click();
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-geometry', 'collision');
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('tool_link');
  await page.getByText('base_link [控制链端点]', { exact: true }).click(); await page.getByRole('button', { name: '适应模型', exact: true }).click();
  const canvas = page.locator('.robot-preview canvas'), box = (await canvas.boundingBox())!; await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected', 'link:tool_link');
  await page.getByRole('button', { name: '切换语言', exact: true }).click(); await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Model resource problems', exact: true })).toContainText('missing-b.dae');
  expect(await snapshot(page)).toBe(before); expect(external).toEqual([]); await page.screenshot({ path: info.outputPath('missing-resources.png') });
});

test('resource inventory includes corrupt meshes and every missing DAE image, including unused declarations', async ({ page }) => {
  const project = resourceProject(), model = fileById(project, project.entrypoints.urdf)!;
  project.files.find(f => f.path.endsWith('part.dae'))!.bytes = utf8.encode(texturedDae.replace('</library_images>', '<image id="unused"><init_from>../textures/unused.png</init_from></image></library_images>'));
  project.files = project.files.filter(f => f.id !== 'paint'); project.files.push(makeFile('models/broken.stl', 'resource', 'not an STL'), makeFile('models/empty.stl', 'resource', 'solid empty\n' + ' '.repeat(100) + '\nendsolid empty'));
  model.bytes = utf8.encode(new TextDecoder().decode(model.bytes).replace('</link><joint', '<visual><origin xyz="0.2 0 0"/><geometry><mesh filename="broken.stl"/></geometry></visual><visual><geometry><mesh filename="empty.stl"/></geometry></visual></link><joint'));
  await open(page, project); const before = await snapshot(page), problems = page.getByRole('region', { name: '模型资源问题', exact: true });
  await expect(problems.locator('li')).toHaveCount(4);
  await expect(problems).toContainText('blue%20paint.png'); await expect(problems).toContainText('unused.png'); await expect(problems).toContainText('broken.stl');
  await expect(problems).toContainText('STL 不包含有效三角形'); expect(await snapshot(page)).toBe(before);
});

test('joint arrows render for movable joints, follow transformed parents and disappear for fixed joints', async ({ page }, info) => {
  const project = axisPreviewProject();
  await open(page, project); const before = await snapshot(page);
  await page.getByText('joint_1 [revolute]', { exact: true }).click();
  await expect(page.getByRole('status', { name: '选中关节轴向', exact: true })).toContainText('1 0 0');
  await expect.poll(() => orangePixels(page)).toBeGreaterThan(10);
  const canvas = page.locator('.robot-preview canvas'), original = await canvas.screenshot();
  const slider = page.getByRole('slider', { name: '关节预览位置', exact: true }); await slider.focus(); await slider.press('End'); await slider.blur();
  await expect(page.getByRole('tooltip')).not.toBeVisible(); await expect.poll(async () => Buffer.compare(original, await canvas.screenshot())).not.toBe(0);
  await page.getByText('mount [fixed]', { exact: true }).click();
  await expect(page.getByRole('status', { name: '选中关节轴向', exact: true })).toContainText('没有单一运动轴');
  await expect.poll(() => orangePixels(page)).toBe(0);
  expect(await snapshot(page)).toBe(before); await page.screenshot({ path: info.outputPath('joint-axis.png') });
});

test('geometry-free models fit their kinematic frames and show a selected connection and axis', async ({ page }, info) => {
  const project = axisPreviewProject();
  fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode('<robot name="frames"><link name="base_link"/><link name="arm"/><link name="tool_link"/><joint name="mount" type="fixed"><parent link="base_link"/><child link="arm"/><origin xyz="3 0 0"/></joint><joint name="joint_1" type="prismatic"><parent link="arm"/><child link="tool_link"/><origin xyz="2 0 0"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint></robot>');
  await open(page, project); const before = await snapshot(page);
  await page.getByText('joint_1 [prismatic]', { exact: true }).click();
  await expect.poll(() => orangePixels(page)).toBeGreaterThan(10);
  await page.getByText('mount [fixed]', { exact: true }).click();
  await expect(page.getByRole('status', { name: '选中关节轴向', exact: true })).toContainText('base_link → arm');
  await expect.poll(() => orangePixels(page, true)).toBeGreaterThan(20);
  expect(await snapshot(page)).toBe(before); await page.screenshot({ path: info.outputPath('kinematic-frames.png') });
});
