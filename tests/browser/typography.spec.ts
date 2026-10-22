import { uiOrigin } from './helpers/origin';
import { expect, test } from '@playwright/test';
import { createExample } from '../../src/core/project/examples';
import { fileById, utf8 } from '../../src/core/project/types';
import { saveProject } from '../../src/core/project/archive';
import { assertBundledFonts } from './helpers/fonts';

test('bundled weights render interface and source text with mixed-language cursor selection and indentation', async ({ page, context, browserName }, info) => {
  const project = createExample('igh');
  const source = '<robot name="机器人A"><link name="base_link"/>\n  <link name="tool_link"/>\n  <joint name="joint_1" type="fixed"><parent link="base_link"/><child link="tool_link"/></joint>\n</robot>';
  fileById(project, project.entrypoints.urdf)!.bytes = utf8.encode(source);
  const external: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(uiOrigin)) external.push(request.url()); });
  await page.goto('/'); await assertBundledFonts(page);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'font.rcproj', mimeType: 'application/zip', buffer: Buffer.from(await saveProject(project)) });
  await page.getByRole('menuitem', { name: '机器人模型', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '配置源码', exact: true }); await expect(editor).toBeVisible(); await editor.scrollIntoViewIfNeeded();
  expect(await editor.evaluate(el => getComputedStyle(el).fontFamily)).toContain('AlibabaPuHuiTi');
  expect(await page.getByRole('button', { name: '应用修改', exact: true }).evaluate(el => getComputedStyle(el).fontFamily)).toContain('AlibabaPuHuiTi');
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    for (const selector of ['.cm-content .cm-line:first-child', '.brand strong', '.source-editor .ant-btn-primary']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(fonts.some(font => font.isCustomFont && font.familyName.includes('Alibaba'))).toBe(true);
    }
    await cdp.detach();
  }
  // Use the rendered glyph boundary, rather than assuming monospaced columns.
  const boundary = await editor.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('机器人A') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index + 2); range.setEnd(node, index + 2);
      const bounds = range.getBoundingClientRect(); return { x: bounds.x, y: bounds.y + bounds.height / 2 };
    }
    throw Error('Missing source text');
  });
  await page.mouse.click(boundary.x, boundary.y); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('人');
  await page.keyboard.insertText('臂'); await expect(editor).toContainText('机器臂A');
  await editor.press('ControlOrMeta+Home'); await editor.press('ArrowDown'); await editor.press('Home'); await editor.press('ControlOrMeta+]');
  await expect(editor.locator('.cm-line').nth(1)).toHaveText('    <link name="tool_link"/>');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(page.locator('.preview-card .ant-card-head-title')).toHaveText('机器臂A');
  await page.getByRole('button', { name: '切换语言', exact: true }).click(); await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click(); await assertBundledFonts(page);
  await expect(editor).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Configuration source', exact: true })).toContainText('机器臂A');
  expect(external).toEqual([]); await page.screenshot({ path: info.outputPath('font-editor-dark-en.png') });
});

test('a font download failure keeps the configuration workflow usable through system fallback', async ({ page }) => {
  const blocked: string[] = [];
  await page.route('**/*.woff2', route => { blocked.push(route.request().url()); return route.abort(); }); await page.goto('/');
  await expect.poll(() => blocked.length).toBeGreaterThan(0); await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'AlibabaPuHuiTi' && font.status === 'error'))).toBe(true);
  await page.getByRole('button', { name: '新建工程', exact: true }).click(); await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('menuitem', { name: '主站配置', exact: true }).click(); await page.getByRole('spinbutton',{name:/^通信周期/}).fill('2500'); await page.getByRole('spinbutton',{name:/^通信周期/}).blur();
  await expect(page.getByRole('spinbutton',{name:/^通信周期/})).toHaveValue('2500'); await expect(page.getByRole('button', { name: '下载工程', exact: true })).toBeVisible();
});
