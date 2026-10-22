import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { resourceProject } from '../fixtures/resources';
import { fileById, utf8 } from '../../src/core/project/types';
import { saveProject } from '../../src/core/project/archive';
const stl = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`;

test('resource import and mapping feed the preview, portable export and fresh-context project reopening', async ({ page, browser }, testInfo) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url()); });
  const p = resourceProject();
  const model = fileById(p, p.entrypoints.urdf)!;
  model.bytes = utf8.encode(new TextDecoder().decode(model.bytes).replace('package://robot_description/meshes/part.dae', '/workstation/triangle.stl'));
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'portable.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await page.getByRole('menuitem', { name: '机器人模型' }).click();
  await expect(page.getByRole('region', { name: '模型资源问题', exact: true })).toContainText('/workstation/triangle.stl');
  await page.getByRole('menuitem', { name: 'APP 配置' }).click();
  await page.getByTestId('resource-files').setInputFiles({ name: 'assets.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'assets/triangle mesh.stl': strToU8(stl) })) });
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.locator('.ant-select[aria-label="映射 mesh[0].filename"] input').fill('triangle mesh');
  await page.locator('.ant-select-item-option[title="assets/triangle mesh.stl"]').click();
  await page.getByRole('menuitem', { name: '机器人模型' }).click();
  await expect(page.getByLabel('机器人三维预览')).toBeVisible();
  await expect(page.getByText(/Mesh 尚未纳入工程/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: '模型资源问题', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '校验工程', exact: true }).click();
  await expect(page.getByText('0 项错误', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查并导出配置', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('/workstation/triangle.stl → ../assets/triangle%20mesh.stl');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载运行包', exact: true }).click();
  const output = testInfo.outputPath('runtime.zip'); await (await downloaded).saveAs(output);
  const files = unzipSync(await readFile(output));
  expect(new TextDecoder().decode(files['models/robot.urdf'])).toContain('../assets/triangle%20mesh.stl');
  expect(new TextDecoder().decode(files['assets/triangle mesh.stl'])).toBe(stl);
  expect(files['models/meshes/part.dae']).toBeUndefined();
  expect(files['web/static/style.css']).toBeDefined();
  const archived = page.waitForEvent('download'); await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const project = testInfo.outputPath('mapped.rcproj'); await (await archived).saveAs(project);
  const fresh = await browser.newContext(); const reopened = await fresh.newPage();
  await reopened.goto('http://127.0.0.1:5173/'); await reopened.locator('input[type=file]').first().setInputFiles(project);
  await reopened.getByRole('menuitem', { name: 'APP 配置' }).click();
  await expect(reopened.locator('.ant-select[aria-label="映射 mesh[0].filename"]')).toContainText('assets/triangle mesh.stl');
  await fresh.close();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('DAE textures resolve through saved mappings and appear in the rendered model without remote fetches', async ({ page }, testInfo) => {
  const { texturedDae, greenPng } = await import('../fixtures/textured-dae');
  const { moveResource } = await import('../../src/core/project/resources');
  const p = resourceProject();
  p.files.find(f => f.path.endsWith('part.dae'))!.bytes = utf8.encode(texturedDae.replace('<init_from>../textures/blue%20paint.png</init_from>', '<init_from>\n  ../textures/blue%20paint.png\n</init_from>'));
  fileById(p, 'paint')!.bytes = greenPng;
  moveResource(p, 'paint', 'assets/relocated paint.png');
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5173')) external.push(r.url()); });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'texture.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await page.getByRole('menuitem', { name: '机器人模型' }).click();
  const canvas = page.getByLabel('机器人三维预览');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: /^俯\s*视$/ }).click();
  // A rendered green area proves the mapped PNG was decoded and applied to the
  // material, rather than merely checking for a canvas or a successful request.
  await expect(async () => {
    const png = await canvas.screenshot();
    const green = await page.evaluate(async base64 => {
      const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
      const out = document.createElement('canvas'); out.width = img.width; out.height = img.height;
      const ctx = out.getContext('2d')!; ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, out.width, out.height).data;
      let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 120 && data[i] < 70 && data[i + 2] < 70) count++;
      return count;
    }, png.toString('base64'));
    expect(green).toBeGreaterThan(500);
  }).toPass({ timeout: 10000 });
  await expect(page.getByText(/部分模型资源无法加载|缺少或外部模型资源|模型预览失败/)).toHaveCount(0);
  await canvas.screenshot({ path: testInfo.outputPath('textured-model.png') });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('import preview selects among candidates, preserves drafts and can be undone as one transaction', async ({ page }, testInfo) => {
  const { digest } = await import('../../src/core/project/types');
  const { openProject } = await import('../../src/core/project/archive');
  const p = resourceProject(), model = fileById(p, p.entrypoints.urdf)!;
  p.editor.buffers[model.id] = { text: '<robot name="draft"><link name="draft"/></robot>', baseHash: await digest(model.bytes) };
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'draft.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await expect(page.getByRole('heading', { name: '工程总览' })).toBeVisible();
  const incoming = { name: 'models.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({
    [model.path]: strToU8('<robot name="replacement"><link name="replacement"/></robot>'),
    'models/alternative.urdf': strToU8('<robot name="alternative"><link name="alternative"/></robot>'),
  })) };
  await page.locator('input[type=file][multiple]').setInputFiles(incoming);
  const dialog = page.getByRole('dialog', { name: '导入预览' });
  await expect(dialog.getByRole('button', { name: '确认导入' })).toBeDisabled();
  await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.locator('input[type=file][multiple]').setInputFiles(incoming);
  await dialog.locator('.ant-select[aria-label="导入 urdf 活动配置"]').click();
  await page.locator('.ant-select-item-option[title="models/robot.urdf · urdf"]').click();
  await expect(dialog).toContainText('替换后仍保留原草稿及基线');
  await dialog.getByRole('button', { name: '确认导入' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const path = testInfo.outputPath('imported.rcproj'); await (await download).saveAs(path);
  const saved = await openProject(await readFile(path));
  expect(saved.files.filter(f => f.role === 'urdf')).toHaveLength(2);
  expect(saved.editor.buffers).toEqual(p.editor.buffers);
  expect(new TextDecoder().decode(fileById(saved, model.id)!.bytes)).toContain('replacement');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undo = page.waitForEvent('download'); await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const undoPath = testInfo.outputPath('undone.rcproj'); await (await undo).saveAs(undoPath);
  const undone = await openProject(await readFile(undoPath));
  expect(undone.files.map(f => [f.id, f.bytes])).toEqual(p.files.map(f => [f.id, f.bytes]));
  expect(undone.editor.buffers).toEqual(p.editor.buffers);
});

test('ENI replacement previews byte hashes and bus changes while preserving the imported XML exactly', async ({ page }, testInfo) => {
  const { createProject, makeFile } = await import('../../src/core/project/create');
  const { digest } = await import('../../src/core/project/types');
  const { openProject } = await import('../../src/core/project/archive');
  const xml = '<EtherCATConfig Version="1.3"><Config><Slave><Info><Name>Drive</Name><PhysAddr>1001</PhysAddr><VendorId>1</VendorId><ProductCode>2</ProductCode></Info><ProcessData><Recv><BitStart>0</BitStart><BitLength>64</BitLength></Recv><Send><BitStart>0</BitStart><BitLength>0</BitLength></Send></ProcessData></Slave><ProcessImage><Inputs><ByteSize>8</ByteSize><Variable><Name>Drive.Inputs.Position</Name><DataType>DINT</DataType><BitSize>32</BitSize><BitOffs>0</BitOffs></Variable></Inputs><Outputs><ByteSize>0</ByteSize></Outputs></ProcessImage></Config></EtherCATConfig>';
  const p = createProject('ENI review', 'ecm'), eni = makeFile('master/eni.xml', 'eni', xml);
  p.files.push(eni); p.entrypoints.master.eniFileId = eni.id; p.editor.confirmations['drive:0'] = true;
  const replacement = xml.replace('<PhysAddr>1001</PhysAddr>', '<PhysAddr>1002</PhysAddr>').replace('<BitOffs>0</BitOffs>', '<BitOffs>8</BitOffs>');
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'eni.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(p)) });
  await expect(page.getByRole('heading', { name: '工程总览' })).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'new.xml', mimeType: 'application/xml', buffer: Buffer.from(replacement) });
  const dialog = page.getByRole('dialog', { name: '导入预览' });
  await expect(dialog).toContainText(await digest(eni.bytes));
  await expect(dialog).toContainText(await digest(utf8.encode(replacement)));
  await expect(dialog).toContainText('地址=1002'); await expect(dialog).toContainText('偏移=8');
  await expect(dialog).toContainText('不会按序号自动重绑');
  await dialog.getByRole('button', { name: '确认导入' }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const path = testInfo.outputPath('eni-replaced.rcproj'); await (await download).saveAs(path);
  const saved = await openProject(await readFile(path));
  expect(new TextDecoder().decode(fileById(saved, saved.entrypoints.master.eniFileId)!.bytes)).toBe(replacement);
  expect(saved.editor.confirmations).toEqual({});
});
