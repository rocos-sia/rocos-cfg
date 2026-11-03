import { uiOrigin } from './helpers/origin';
import { activate, edit, tabTo, type InputMode } from './helpers/input';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { openProject, saveProject } from '../../src/core/project/archive';
import { createExample } from '../../src/core/project/examples';
import { fileById, textOf } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';

async function navigate(page:Page,label:string,mode:InputMode) {
 const target=page.getByRole('menuitem',{name:label,exact:true});
 if(mode==='touch')await target.tap();
 else {
  await tabTo(page,page.getByRole('menu'),true);await page.keyboard.press('Home');
  const labels=['工程总览','总线配置','应用配置','仿真配置','校验和导出'];
  for(let i=0;i<labels.indexOf(label);i++)await page.keyboard.press('ArrowDown');
  await expect(target).toBeFocused();await page.keyboard.press('Enter');
 }
}
async function review(page:Page,mode:InputMode) {
 await navigate(page,'应用配置',mode);
 const hardware=page.locator('.application-tabs [role="tab"]').nth(2);
 if(mode==='touch')await hardware.tap();
 else await hardware.press('Enter');
 await expect(hardware).toHaveAttribute('aria-selected','true');
 const approval=page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true});
 await expect(approval).toBeVisible();
 if(!await approval.isChecked()){
  if(mode==='touch')await approval.tap();else{await tabTo(page,approval);await page.keyboard.press('Space');}
 }
 await expect(approval).toBeChecked();
}
for(const kind of ['igh','ecm'] as const)for(const mode of ['keyboard','touch'] as const)test(`${kind} ENI teaching example edits, saves, reopens and exports with ${mode}`,async({browser},info)=>{
 test.setTimeout(90000);
 const opts={viewport:mode==='touch'?{width:1024,height:900}:{width:1440,height:1000},hasTouch:mode==='touch'};
 const context=await browser.newContext(opts),page=await context.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 const initial=createExample(kind);
 const eni=fileById(initial,initial.entrypoints.master.eniFileId)!.bytes;
 await page.goto('/');
 await page.locator('input[type=file]').first().setInputFiles({name:'teaching.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(initial))});
 await expect(page.locator('.project-name strong')).toHaveText('教学示例');
 await navigate(page,'总线配置',mode);
 await edit(page,page.getByRole('spinbutton',{name:/^通信周期/}),'2000',mode);
 await expect(page.getByRole('button',{name:'新增从站',exact:true})).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'ENI 原文 · 只读',exact:true})).toBeVisible();
 await review(page,mode);
 const downloading=page.waitForEvent('download');await activate(page,page.getByRole('button',{name:'下载工程',exact:true}),mode);
 const path=info.outputPath(`${kind}-${mode}.rcproj`);await(await downloading).saveAs(path);
 const p=await openProject(await readFile(path));
 expect(readYaml(textOf(fileById(p,p.entrypoints.master.fileId)!)).cycle).toBe(2000n);
 expect(fileById(p,p.entrypoints.master.eniFileId)!.bytes).toEqual(eni);
 await context.close();
 const fresh=await browser.newContext(opts),reopened=await fresh.newPage();await reopened.goto(uiOrigin);
 await reopened.locator('input[type=file]').first().setInputFiles(path);
 await expect(reopened.locator('.project-name strong')).toHaveText(p.name);
 await review(reopened,mode);
 await navigate(reopened,'校验和导出',mode);
 await activate(reopened,reopened.getByRole('button',{name:'检查并导出配置',exact:true}),mode);
 await expect(reopened.getByRole('dialog',{name:'运行包导出计划'})).toBeVisible();
 const runtime=reopened.waitForEvent('download');await activate(reopened,reopened.getByRole('button',{name:'下载运行包',exact:true}),mode);
 const runtimePath=info.outputPath(`${kind}-${mode}-runtime.zip`);await(await runtime).saveAs(runtimePath);
 const entries=unzipSync(await readFile(runtimePath));
 expect(readYaml(new TextDecoder().decode(entries[`master/${kind}.yaml`])).cycle).toBe(2000n);
 expect(entries['master/eni.xml']).toEqual(eni);
 expect(Object.keys(entries).some(p=>p.startsWith('project-data/'))).toBe(false);
 expect(errors).toEqual([]);await fresh.close();
});
