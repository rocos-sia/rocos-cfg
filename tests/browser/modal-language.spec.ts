import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { resourceProject } from '../fixtures/resources';
import { saveProject } from '../../src/core/project/archive';
import { planRuntime } from '../../src/core/export';
import { baseTarget } from '../../src/core/project/profiles';
import type { Project } from '../../src/core/project/types';

async function locale(page:Page,value:'zh-CN'|'en-US'){
  await page.evaluate(async next=>{const path='/src/i18n/index.ts';const {setLocale}=await import(path);setLocale(next);},value);
}
async function snapshot(page:Page){
  return page.evaluate(async()=>{const path='/src/store.ts';const {useProject}=await import(path);return JSON.stringify(useProject.getState().project);});
}
async function open(page:Page,p:Project){
  const initial=(await snapshot(page))==='null';
  await page.locator('input[type=file]').first().setInputFiles({name:'工程总览-{v0}.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  if(initial)await expect(page.locator('.project-name strong')).toHaveText(p.name);
  else await expect(page.getByRole('dialog')).toBeVisible();
}
async function resources(page:Page){
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
  const row=page.locator('.ant-table-row').filter({has:page.locator('small',{hasText:/^scripts$/})});
  await row.getByRole('button',{name:/^外\s*部$/}).click();
}
async function deletion(page:Page){
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  await page.getByText('joint [revolute]',{exact:true}).click();
  await page.getByRole('button',{name:'删除节点',exact:true}).click();
}

test('external-resource confirmation translates in place and only applies when confirmed',async({page})=>{
  const p=resourceProject();await page.goto('/');await open(page,p);const before=await snapshot(page);
  await resources(page);const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('由目标环境提供此资源');
  await dialog.evaluate(el=>{el.setAttribute('data-original-dialog','yes');});
  await locale(page,'en-US');await expect(dialog).toHaveAttribute('data-original-dialog','yes');
  await expect(dialog).toContainText('Resource supplied by target environment');
  await expect(dialog).toContainText('will retain its original path');
  expect(await snapshot(page)).toBe(before);
  await dialog.getByRole('button',{name:'Mark as external dependency',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const after=JSON.parse((await snapshot(page))!);
  expect(after.references.find((r:{field:string})=>r.field==='scripts').state).toBe('external');
  expect(after.files).toEqual(JSON.parse(before!).files);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(JSON.parse((await snapshot(page))!).references).toEqual(JSON.parse(before!).references);
});

test('target-rule confirmation updates both ways without modifying the captured source',async({page})=>{
  const p=resourceProject();p.targets.master=baseTarget('igh');
  await page.goto('/');await open(page,p);const before=await snapshot(page);
  await page.getByRole('button',{name:'补存当前规则',exact:true}).click();
  await locale(page,'en-US');const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Confirm target rules');await expect(dialog).toContainText(p.targets.master.version);
  await expect(dialog.getByRole('button',{name:'Use these rules',exact:true})).toBeVisible();
  await locale(page,'zh-CN');await expect(dialog).toContainText('确认目标规则');
  expect(await snapshot(page)).toBe(before);
  await dialog.getByRole('button',{name:/^取\s*消$/}).click();expect(await snapshot(page)).toBe(before);
});

test('export plan retains expanded details, focus and exact prepared bytes across locale changes',async({page},info)=>{
  const p=resourceProject();await page.goto('/');await open(page,p);const before=await snapshot(page),expected=planRuntime(p);
  await page.getByRole('menuitem',{name:'校验与导出',exact:true}).click();await page.getByRole('button',{name:'检查并导出配置',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('运行包导出计划');
  await dialog.locator('summary').click();await dialog.getByRole('button',{name:'下载运行包',exact:true}).focus();
  await locale(page,'en-US');await expect(dialog).toContainText('Runtime export plan');
  await expect(dialog.locator('details')).toHaveAttribute('open','');
  await expect(dialog.getByRole('button',{name:'Download runtime package',exact:true})).toBeFocused();
  expect(await snapshot(page)).toBe(before);
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download runtime package',exact:true}).click();
  const path=info.outputPath('runtime.zip');await(await download).saveAs(path);const entries=unzipSync(await readFile(path));
  for(const file of expected.files)expect(entries[file.path]).toEqual(file.bytes);
  expect(await snapshot(page)).toBe(before);
});

test('project-switch confirmation preserves identifiers, cancel and async accept across locale changes',async({page})=>{
  const p=resourceProject();p.name='当前工程-{v0}';await page.goto('/');await open(page,p);const before=await snapshot(page);
  const next=structuredClone(p);next.name='所选工程-{v0}';await open(page,next);
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('切换工程');
  await dialog.locator('summary').click();await locale(page,'en-US');
  await expect(dialog).toContainText('Switch project');await expect(dialog).toContainText(p.name);await expect(dialog).toContainText(next.name);
  await expect(dialog.locator('details')).toHaveAttribute('open','');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await snapshot(page)).toBe(before);
  await open(page,next);await expect(dialog).toContainText('Switch project');await locale(page,'zh-CN');
  await dialog.getByRole('button',{name:'打开新工程',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.project-name strong')).toHaveText(next.name);
  expect(JSON.parse((await snapshot(page))!).files).toEqual(JSON.parse(before!).files);
});

test('deletion chooser translates its custom footer and opens the unchanged second-step plan',async({page},info)=>{
  await page.goto('/');await open(page,resourceProject());const before=await snapshot(page);await deletion(page);
  await locale(page,'en-US');const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Choose deletion behavior');
  await expect(dialog.getByRole('button',{name:'Delete and keep descendants',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('delete-en-mobile.png')});
  expect(await snapshot(page)).toBe(before);
  await dialog.getByRole('button',{name:'Delete and keep descendants',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Confirm model and reference changes'})).toBeVisible();
  await locale(page,'zh-CN');await page.getByRole('dialog',{name:'确认模型与引用变更'}).getByRole('button',{name:/^取\s*消$/}).click();
  expect(await snapshot(page)).toBe(before);
});

for(const kind of ['resource','deletion'] as const)test(`${kind} confirmation rejects a replacement workspace with the same UUID and revision`,async({page})=>{
  await page.goto('/');await open(page,resourceProject());if(kind==='resource')await resources(page);else await deletion(page);
  await page.evaluate(async()=>{const path='/src/store.ts';const {useProject}=await import(path);const next=structuredClone(useProject.getState().project);next.name='替换工程';useProject.getState().load(next);});
  const before=await snapshot(page);await locale(page,'en-US');
  await page.getByRole('dialog').getByRole('button',{name:kind==='resource'?'Mark as external dependency':'Delete and keep descendants',exact:true}).click();
  await expect(page.getByText(/The project has changed\./)).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Confirm model and reference changes'})).not.toBeVisible();
  expect(await snapshot(page)).toBe(before);
});
