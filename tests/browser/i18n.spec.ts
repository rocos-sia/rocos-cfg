import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileById, textOf } from '../../src/core/project/types';
import { saveProject, openProject } from '../../src/core/project/archive';
import { resourceProject } from '../fixtures/resources';

test('switches language without remounting the source editor or translating project data and drafts',async({page},info)=>{
  const project=resourceProject();project.name='中文工程 Original';
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'中文工程.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(project))});
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
  const source=page.getByRole('textbox',{name:'配置源码',exact:true});const original=textOf(fileById(project,project.entrypoints.app)!);
  const draft=original+'\n# 中文草稿：工程总览，参数原名不翻译';await source.fill(draft);await source.blur();
  await expect(page.getByText('源码草稿尚未应用，运行配置导出将被阻止')).toBeVisible();
  await source.evaluate(el=>el.setAttribute('data-language-test','retained'));
  await source.focus();await source.press('Control+f');await page.getByRole('textbox',{name:'查找',exact:true}).fill('中文草稿');
  await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','en-US');
  await expect(page.getByRole('menuitem',{name:'APP configuration',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'APP configuration',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'HTTP listen address',exact:true})).toHaveValue('0.0.0.0');
  const translated=page.getByRole('textbox',{name:'Configuration source',exact:true});
  await expect(translated).toHaveAttribute('data-language-test','retained');expect((await translated.locator('.cm-line').allTextContents()).join('\n')).toBe(draft);
  await expect(page.locator('.project-name strong')).toHaveText(project.name);
  await expect(page.getByRole('textbox',{name:'Find',exact:true})).toHaveValue('中文草稿');
  await page.locator('.cm-search').getByRole('button',{name:'close',exact:true}).click();
  await expect(page.getByText('The source draft has not been applied. Runtime export is blocked.',{exact:true})).toBeVisible();
  await translated.focus();await translated.press('Control+z');expect((await translated.locator('.cm-line').allTextContents()).join('\n')).toBe(original);
  await translated.press('Control+Shift+z');expect((await translated.locator('.cm-line').allTextContents()).join('\n')).toBe(draft);await translated.blur();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download project',exact:true}).click();
  const path=info.outputPath('bilingual.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  expect(restored.name).toBe(project.name);expect(restored.files.map(f=>({path:f.path,bytes:f.bytes}))).toEqual(project.files.map(f=>({path:f.path,bytes:f.bytes})));
  expect(restored.editor.buffers[project.entrypoints.app!].text).toBe(draft);
  expect(JSON.stringify(restored)).not.toContain('rocos-locale');
  await page.getByRole('button',{name:'Change language',exact:true}).click();await page.getByRole('menuitem',{name:'简体中文',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');await expect(page.getByRole('textbox',{name:'配置源码',exact:true})).toHaveAttribute('data-language-test','retained');
});

test('persists the interface language across reloads and localizes the project creation dialog',async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en-US');
  await page.getByRole('button',{name:'New project',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'New configuration project'});await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('English project');await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.locator('.project-name strong')).toHaveText('English project');await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.locator('.save-state')).toContainText(/Project loaded|Draft cached/);
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Toggle theme',exact:true}).click();
  await expect(page.locator('.shell')).toHaveAttribute('data-theme','dark');
  expect(await page.locator('.sidebar .ant-menu-title-content').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth))).toBe(true);
  await page.screenshot({path:info.outputPath('english-dark-overview.png'),fullPage:true});
});
