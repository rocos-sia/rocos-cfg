import { projectSnapshot as snapshot } from './helpers/project';
import { expect, test, type Page } from '@playwright/test';
import { resourceProject } from '../fixtures/resources';
import { saveProject } from '../../src/core/project/archive';
import { digest, fileById, textOf, utf8, type Project } from '../../src/core/project/types';
async function locale(page:Page,value:'zh-CN'|'en-US'){
  await page.evaluate(async next=>{const path='/src/i18n/index.ts';const {setLocale}=await import(path);setLocale(next);},value);
}
async function open(page:Page,p:Project){
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'通知-{v0}.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.locator('.project-name strong')).toHaveText(p.name);
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'配置源码',exact:true})).toBeVisible();
  const now=new Date('2026-10-22T00:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(now);
}
const notices=(page:Page)=>page.locator('.ant-message-notice');

test('success notification changes language in place without restarting its timeout or source editor',async({page})=>{
  const p=resourceProject();await open(page,p);
  const source=page.getByRole('textbox',{name:'配置源码',exact:true});await source.fill(textOf(fileById(p,p.entrypoints.app)!)+'\n# 工程总览-{v0}');await source.blur();
  await page.getByRole('button',{name:'保留源码草稿',exact:true}).click();await expect(notices(page)).toHaveText('源码草稿已保留，可随工程保存');
  const before=await snapshot(page);await source.evaluate(el=>el.setAttribute('data-notification-test','same-editor'));
  await notices(page).evaluate(el=>el.setAttribute('data-notification-test','same-notice'));
  await page.clock.runFor(1800);await locale(page,'en-US');
  await expect(notices(page)).toHaveCount(1);await expect(notices(page)).toHaveAttribute('data-notification-test','same-notice');
  await expect(notices(page)).toHaveText('Source draft retained. Save it with the project.');
  await expect(page.getByRole('textbox',{name:'Configuration source',exact:true})).toHaveAttribute('data-notification-test','same-editor');
  expect(await snapshot(page)).toBe(before);
  await page.clock.runFor(1300);await expect(notices(page)).toHaveCount(0);
  await locale(page,'zh-CN');await expect(notices(page)).toHaveCount(0);expect(await snapshot(page)).toBe(before);
});

test('resource error notification translates after failed confirmation without applying a mapping',async({page},info)=>{
  const p=resourceProject();await open(page,p);const before=await snapshot(page);
  const row=page.locator('.ant-table-row').filter({has:page.locator('small',{hasText:/^robot\.urdf$/})});
  await row.getByRole('button',{name:/^外\s*部$/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'标记为外部依赖',exact:true}).click();
  await expect(notices(page)).toContainText('主站和 APP 核心配置必须纳入工程');
  await locale(page,'en-US');await expect(notices(page)).toContainText('Core master and APP configuration must be included in the project');
  await page.setViewportSize({width:390,height:844});
  const bounds=await notices(page).boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('notification-en-mobile.png')});
  await locale(page,'zh-CN');await expect(notices(page)).toContainText('不能标记为外部资源');expect(await snapshot(page)).toBe(before);
});

test('source baseline conflicts stay actionable in either language and retain the draft and original bytes',async({page})=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.app)!;
  p.editor.buffers[file.id]={text:textOf(file)+'\n# 用户草稿-{v0}',baseHash:await digest(file.bytes)};
  file.bytes=utf8.encode(textOf(file)+'\n# 外部修改');await open(page,p);const before=await snapshot(page);
  await page.getByRole('button',{name:'应用修改',exact:true}).click();await expect(notices(page)).toContainText('源码草稿基线冲突');
  await locale(page,'en-US');await expect(notices(page)).toContainText('conflicts with the draft baseline');
  await expect(page.getByRole('textbox',{name:'Configuration source',exact:true})).toContainText('# 用户草稿-{v0}');
  expect(await snapshot(page)).toBe(before);
  await page.clock.runFor(3100);await expect(notices(page)).toHaveCount(0);
});

test('third-party YAML details and user text remain literal when an existing notification changes language',async({page})=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.app)!;
  p.editor.buffers[file.id]={text:'value: [工程总览-{v0}',baseHash:await digest(file.bytes)};
  await open(page,p);const before=await snapshot(page);
  await page.getByRole('button',{name:'应用修改',exact:true}).click();await expect(notices(page)).toHaveCount(1);
  const original=await notices(page).innerText();expect(original).toContain('工程总览-{v0}');
  await locale(page,'en-US');expect(await notices(page).innerText()).toBe(original);expect(await snapshot(page)).toBe(before);
});
