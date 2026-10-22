import { expect, test, type Page } from '@playwright/test';
import { createProject } from '../../src/core/project/create';
import { makeFile } from '../../src/core/project/create';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf, utf8, type Project } from '../../src/core/project/types';
import { readFile } from 'node:fs/promises';

async function trackWorkers(page:Page){
  await page.addInitScript(()=>{
    const Original=window.Worker,records:{kind:string;epoch:number;revision:number;terminated:boolean}[]=[];
    (window as any).__analysisJobs=records;
    window.Worker=class extends Original{
      record?:typeof records[number];
      postMessage(data:any,...options:any[]){
        if(data.kind==='analyze'){this.record={kind:data.kind,epoch:data.workspaceEpoch,revision:data.project.revision,terminated:false};records.push(this.record);}
        super.postMessage(data,...options as [StructuredSerializeOptions]);
      }
      terminate(){if(this.record)this.record.terminated=true;super.terminate();}
    };
  });
}
function largeProject(){
  const p=createProject('large robot','igh',{robotTemplate:'robot.two-axis',parameters:{prefix:'large'}});
  const urdf=fileById(p,p.entrypoints.urdf)!;urdf.bytes=utf8.encode(textOf(urdf)+'\n<!--'+ 'padding '.repeat(36000)+'-->');return p;
}
async function open(page:Page,p:Project){await page.locator('input[type=file]').first().setInputFiles({name:'analysis.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});}

test('large URDF views run in a worker and retain selection after editing the selected joint',async({page})=>{
  await trackWorkers(page);await page.goto('/');await open(page,largeProject());
  await page.getByRole('menuitem',{name:'机器人模型'}).click();
  await expect(page.locator('.model-tree')).toContainText('large_joint_2');
  await page.getByText('large_joint_1 [revolute]',{exact:true}).click();
  await page.getByLabel('位置 xyz (m)',{exact:true}).fill('0.1 0 0');await page.getByLabel('位置 xyz (m)',{exact:true}).blur();
  await expect(page.getByLabel('位置 xyz (m)',{exact:true})).toHaveValue('0.1 0 0');
  await expect(page.locator('.model-tree')).toContainText('large_joint_2');
  const jobs=await page.evaluate(()=>(window as any).__analysisJobs);
  expect(jobs.some((job:any)=>job.revision===0&&job.terminated)).toBe(true);
  expect(jobs.some((job:any)=>job.revision===1&&job.terminated)).toBe(true);
  const source=page.getByLabel('配置源码',{exact:true});await source.fill('<robot unfinished');
  await expect(page.getByText('源码草稿尚未应用，运行配置导出将被阻止',{exact:true})).toBeVisible();
  await expect(source).toBeFocused();await expect(source).toHaveText('<robot unfinished');
  expect(await page.evaluate(()=>(window as any).__analysisJobs.length)).toBe(jobs.length);
});

test('switching to a same-UUID same-revision snapshot terminates older analysis and never displays its model',async({page})=>{
  await trackWorkers(page);
  await page.route('**/archive.worker.ts*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nconst actual=self.onmessage;self.onmessage=e=>{if(e.data.kind==="analyze")setTimeout(()=>actual(e),20000);else actual(e);};'});
  });
  await page.goto('/');const old=largeProject();await open(page,old);
  await expect(page.getByRole('status').filter({hasText:'正在后台解析当前工程'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__analysisJobs.length)).toBe(1);
  const replacement=createProject('replacement','igh',{robotTemplate:'robot.two-axis',parameters:{prefix:'latest'}});replacement.id=old.id;
  await open(page,replacement);const dialog=page.getByRole('dialog',{name:'切换工程'});
  await expect(dialog).toContainText('同一工程的另一份文件');await dialog.getByRole('button',{name:'打开新工程',exact:true}).click();
  await page.getByRole('menuitem',{name:'机器人模型'}).click();
  await expect(page.locator('.model-tree')).toContainText('latest_joint_2');await expect(page.locator('.model-tree')).not.toContainText('large_joint');
  expect(await page.evaluate(()=>(window as any).__analysisJobs[0].terminated)).toBe(true);
  await expect(page.getByRole('status').filter({hasText:'正在后台解析当前工程'})).toHaveCount(0);
});

test('failed background parsing can be retried without replacing the project or falling back to blocking parsing',async({page})=>{
  let rejectAnalysis=true;
  await page.route('**/archive.worker.ts*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+(rejectAnalysis?'\nconst actual=self.onmessage;self.onmessage=e=>{if(e.data.kind==="analyze")self.postMessage({type:"error",message:"simulated worker unavailable"});else actual(e);};':'')});
  });
  await page.goto('/');await open(page,largeProject());await expect(page.getByText('simulated worker unavailable',{exact:true})).toBeVisible();
  await expect(page.locator('.project-name strong')).toHaveText('large robot');
  rejectAnalysis=false;await page.getByRole('button',{name:'重新解析',exact:true}).click();await page.getByRole('menuitem',{name:'机器人模型'}).click();
  await expect(page.locator('.model-tree')).toContainText('large_joint_2');
});

test('large ENI catalogs come from background parsing and startup edits preserve every ENI byte',async({page},testInfo)=>{
  await trackWorkers(page);const p=createProject('large ENI','ecm');
  const original=await readFile('tests/fixtures/eni-seven-drives.xml','utf8');
  const eni=makeFile('master/eni.xml','eni',original+'\n<!--'+'padding '.repeat(36000)+'-->');p.files.push(eni);p.entrypoints.master.eniFileId=eni.id;
  await page.goto('/');await open(page,p);await page.getByRole('menuitem',{name:'主站配置'}).click();
  await expect(page.getByRole('tab',{name:'从站 (7)',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'过程映像 (91)',exact:true})).toBeVisible();
  await page.getByRole('spinbutton',{name:/^通信周期/}).fill('2000');await page.getByRole('spinbutton',{name:/^通信周期/}).blur();
  await expect(page.getByRole('spinbutton',{name:/^通信周期/})).toHaveValue('2000');
  await expect.poll(()=>page.evaluate(()=>(window as any).__analysisJobs.some((job:any)=>job.revision===1&&job.terminated))).toBe(true);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=testInfo.outputPath('large-eni.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path));expect(fileById(restored,eni.id)?.bytes).toEqual(eni.bytes);
});
