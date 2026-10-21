import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, utf8 } from '../../src/core/project/types';

test('relabels existing worker diagnostics without revalidation and preserves Chinese configuration paths',async({page},info)=>{
  const p=resourceProject();
  editProjectYaml(p,p.entrypoints.app!,doc=>doc.setIn(['robot','urdf'],'中文目录/工程总览.urdf'));
  editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.setIn(['hardware',0,'transform','ratio'],0));
  await page.addInitScript(()=>{
    const original=Worker.prototype.postMessage;
    (window as any).__validationJobs=0;
    Worker.prototype.postMessage=function(message:any,...rest:any[]){
      if(message?.kind==='validate')(window as any).__validationJobs++;
      return (original as any).call(this,message,...rest);
    };
  });
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'diagnostics.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('button',{name:'校验工程',exact:true}).click();
  await expect(page.getByRole('cell',{name:'robot.urdf：中文目录/工程总览.urdf 未找到',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__validationJobs)).toBe(1);
  await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await expect(page.getByRole('cell',{name:'robot.urdf: 中文目录/工程总览.urdf — not found',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__validationJobs)).toBe(1);
  await page.getByRole('menuitem',{name:'Hardware & bindings',exact:true}).click();
  await expect(page.getByText('ratio requires an explicit finite nonzero number',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Change language',exact:true}).click();await page.getByRole('menuitem',{name:'简体中文',exact:true}).click();
  await expect(page.getByText('ratio 须明确填写有限非零数',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('unchanged.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(restored.files).toEqual(p.files);expect(restored.editor).toEqual(p.editor);
});

test('translates URDF worker analysis without reparsing or changing legacy hardware XML',async({page},info)=>{
  const p=resourceProject();
  const legacy='<hardware><limit vel="bad"/><mesh filename="missing.stl"/></hardware>';
  // Force the real analysis Worker path, including its structured diagnostic payload.
  fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode('<robot name="r"><!--'+'x'.repeat(270000)+'--><link name="base"/><link name="tip"><visual><geometry><box size="0 1 1"/></geometry></visual></link><joint name="工程总览-{v0}" type="continuous"><parent link="base"/><child link="tip"/><axis xyz="0 0 0"/>'+legacy+'</joint></robot>');
  await page.addInitScript(()=>{
    const original=Worker.prototype.postMessage;(window as any).__analysisJobs=0;
    Worker.prototype.postMessage=function(message:any,...rest:any[]){
      if(message?.kind==='analyze')(window as any).__analysisJobs++;
      return (original as any).call(this,message,...rest);
    };
  });
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'urdf-diagnostics.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  await expect(page.getByText('工程总览-{v0} 轴向不能为零',{exact:true})).toBeVisible();
  const jobs=await page.evaluate(()=>(window as any).__analysisJobs);expect(jobs).toBeGreaterThan(0);
  await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await expect(page.getByText('工程总览-{v0} axis must not be zero',{exact:true})).toBeVisible();
  await expect(page.getByText('tip.visual[0].size requires three positive numbers',{exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Hardware & bindings',exact:true}).click();
  await expect(page.getByText('工程总览-{v0} axis must not be zero; tip.visual[0].size requires three positive numbers',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__analysisJobs)).toBe(jobs);
  await page.getByRole('button',{name:'Change language',exact:true}).click();await page.getByRole('menuitem',{name:'简体中文',exact:true}).click();
  await expect(page.getByText('工程总览-{v0} 轴向不能为零；tip.visual[0].size 需要三个正数值',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('urdf-unchanged.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(restored.files).toEqual(p.files);expect(restored.editor).toEqual(p.editor);
});
