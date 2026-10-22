import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { inspectProjectArchive, openProject, saveProject } from '../../src/core/project/archive';
import { packZip, unpackZip } from '../../src/core/project/zip';
import { makeFile } from '../../src/core/project/create';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { fileById, textOf, utf8 } from '../../src/core/project/types';

const locale=async(page:Page,value:'zh-CN'|'en-US')=>page.evaluate(async value=>{const path='/src/i18n/index.ts';(await import(path)).setLocale(value);},value);
async function countJobs(page:Page){
  await page.addInitScript(()=>{const original=Worker.prototype.postMessage;(window as any).__archiveJobs=0;Worker.prototype.postMessage=function(message:any,...rest:any[]){if(['inspect','recover'].includes(message?.kind))(window as any).__archiveJobs++;return (original as any).call(this,message,...rest);};});
}
test('readonly archive reasons change language without rerunning the worker or repacking unknown content',async({page},info)=>{
  const p=resourceProject();p.name='工程总览-{v0}';const entries=unpackZip(await saveProject(p));
  const manifest=JSON.parse(new TextDecoder().decode(entries.get('rocos-project.json')));manifest.formatVersion=99;
  entries.set('rocos-project.json',utf8.encode(JSON.stringify(manifest)));const bytes=packZip(entries);
  expect((await inspectProjectArchive(bytes)).mode).toBe('readonly');
  await countJobs(page);await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'未来工程.rcproj',mimeType:'application/zip',buffer:Buffer.from(bytes)});
  await expect(page.getByRole('dialog',{name:'工程只读预览'})).toContainText('工程格式版本不受支持');
  const jobs=await page.evaluate(()=>(window as any).__archiveJobs);await locale(page,'en-US');
  const dialog=page.getByRole('dialog',{name:'Read-only project preview'});
  await expect(dialog).toContainText('Unsupported project format version');await expect(dialog).toContainText(p.name);
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});
    const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
    expect(await dialog.locator('.ant-modal-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`readonly-en-${width}.png`),fullPage:true});
  }
  expect(await page.evaluate(()=>(window as any).__archiveJobs)).toBe(jobs);
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Copy original archive',exact:true}).click();
  const path=info.outputPath('original.rcproj');await(await download).saveAs(path);expect(new Uint8Array(await readFile(path))).toEqual(bytes);
  await locale(page,'zh-CN');await expect(page.getByRole('dialog',{name:'工程只读预览'})).toContainText('工程格式版本不受支持');
});
test('recovery errors, checks and notes relabel in place and restored notices remain translatable after saving',async({page},info)=>{
  const p=resourceProject(),bad=makeFile('中文目录/工程总览-{v0}.txt','attachment','original');p.files.push(bad);
  const entries=unpackZip(await saveProject(p));entries.set(bad.path,utf8.encode('modified'));const bytes=packZip(entries);
  await countJobs(page);await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'损坏.rcproj',mimeType:'application/zip',buffer:Buffer.from(bytes)});
  await expect(page.getByRole('dialog',{name:'工程完整性检查失败'})).toContainText('文件 SHA-256 不匹配：'+bad.path);
  await locale(page,'en-US');const dialog=page.getByRole('dialog',{name:'Project integrity check failed'});
  await expect(dialog).toContainText('File SHA-256 mismatch: '+bad.path);
  await dialog.getByRole('button',{name:'Inspect recoverable files',exact:true}).click();
  await expect(dialog).toContainText('All device, mechanical parameter and binding confirmations were reset');
  await page.screenshot({path:info.outputPath('recovery-en.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});expect(await dialog.locator('.ant-modal-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('recovery-en-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  const jobs=await page.evaluate(()=>(window as any).__archiveJobs);expect(jobs).toBe(2);
  await locale(page,'zh-CN');await expect(page.getByRole('dialog',{name:'工程完整性检查失败'})).toContainText('人工确认全部重置');
  await locale(page,'en-US');expect(await page.evaluate(()=>(window as any).__archiveJobs)).toBe(jobs);
  await dialog.getByRole('button',{name:'Create recovered project',exact:true}).click();
  await expect(page.locator('.project-name strong')).toHaveText(p.name+'（恢复）');
  await page.getByRole('button',{name:'Validate project',exact:true}).click();
  await expect(page.getByRole('main').getByText(/This project was recovered from a damaged archive/)).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download project',exact:true}).click();
  const path=info.outputPath('recovered.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  expect(restored.files.some(f=>f.id===bad.id)).toBe(false);for(const file of p.files.filter(f=>f.id!==bad.id))expect(fileById(restored,file.id)!.bytes).toEqual(file.bytes);
  expect(restored.editor.notices!.at(-1)!.text).toBeDefined();
  await locale(page,'zh-CN');await expect(page.getByRole('main').getByText(/此工程从损坏包恢复/)).toBeVisible();
});
test('import selection errors and bus differences change language while cancelling keeps configuration bytes',async({page},info)=>{
  const p=resourceProject(),next=structuredClone(p);editProjectYaml(next,next.entrypoints.master.fileId!,doc=>{doc.setIn(['slaves',0,'name'],'工程总览-{name}');doc.setIn(['slaves',0,'tx_pdos',0,'entries'],[]);});
  const incoming=fileById(next,next.entrypoints.master.fileId)!;
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'project.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.locator('.project-name strong')).toHaveText(p.name);
  await page.locator('input[type=file][multiple]').first().setInputFiles(['one','two'].map(name=>({name:name+'.yaml',mimeType:'text/yaml',buffer:Buffer.from(incoming.bytes)})));
  await expect(page.getByRole('dialog',{name:'导入预览'})).toContainText('请选择 master 的活动配置');
  await locale(page,'en-US');const dialog=page.getByRole('dialog',{name:'Import preview'});
  await expect(dialog).toContainText('Select the active master configuration');
  await dialog.getByRole('combobox').click();await page.getByTitle('one.yaml · igh',{exact:true}).click();
  await expect(dialog).toContainText('Name=工程总览-{name};');await expect(dialog).toContainText('Slave 0');
  await expect(dialog).not.toContainText('runtime discovery');
  await locale(page,'zh-CN');await expect(page.getByRole('dialog',{name:'导入预览'})).toContainText('名称=工程总览-{name}');
  await page.getByRole('dialog',{name:'导入预览'}).getByRole('button',{name:/^取\s*消$/}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('unchanged.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));expect(restored.files).toEqual(p.files);expect(restored.editor).toEqual(p.editor);
});
test('an import preview cannot apply to a different session with the same project ID and revision',async({page},info)=>{
  const p=resourceProject();await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'base.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.locator('.project-name strong')).toHaveText(p.name);
  const master=fileById(p,p.entrypoints.master.fileId)!;
  await page.locator('input[type=file][multiple]').first().setInputFiles({name:'replace.yaml',mimeType:'text/yaml',buffer:Buffer.from(textOf(master).replace('Drive','不应导入'))});
  const dialog=page.getByRole('dialog',{name:'导入预览'});await expect(dialog).toBeVisible();
  await page.evaluate(async()=>{const path='/src/store.ts';const {useProject}=await import(path);const next=structuredClone(useProject.getState().project);next.name='另一个会话';useProject.getState().load(next);});
  await dialog.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByText(/导入期间工程已变化，请重新选择文件/)).toBeVisible();
  await dialog.getByRole('button',{name:/^取\s*消$/}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('session.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));expect(restored.name).toBe('另一个会话');expect(restored.files).toEqual(p.files);
});
