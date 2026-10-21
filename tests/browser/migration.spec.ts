import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject } from '../../src/core/project/create';
import { openProject, saveProject } from '../../src/core/project/archive';

test('reviews a staged migration without replacing the workspace and copies the untouched source before adoption',async({page},info)=>{
  const original=await saveProject(createProject('迁移测试工程','igh'));
  const source={name:'source.rcproj',mimeType:'application/zip',buffer:Buffer.from(original)};
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('保留当前工作区');await page.getByRole('button',{name:'创建工程',exact:true}).click();
  // No historical ROCOS schema exists yet. Inject ONLY a report after the real
  // archive decoder; exercise the pending-migration UI without accepting a
  // fabricated schema in production. Pure transformation chains have unit tests.
  const reportWorker=async()=>page.route('**/archive.worker.ts*',async route=>{
    await route.fulfill({contentType:'application/javascript',body:`
      import { inspectProjectArchive } from '/src/core/project/archive.ts';
      self.onmessage=async(event)=>{
        const result=await inspectProjectArchive(event.data.bytes);
        result.migration={from:1,to:2,steps:[{id:'test-report-only',from:1,to:2,description:'测试夹具迁移报告',changedPaths:['project-data/editor-state.json'],manifestChanged:true}]};
        self.postMessage({type:'result',result});
      };
    `});
  },{times:1});
  await reportWorker();await page.locator('input[type=file]').first().setInputFiles(source);
  const preview=page.getByRole('dialog',{name:'工程迁移预览'});
  await expect(preview).toContainText('test-report-only');await expect(preview).toContainText('project-data/editor-state.json');
  await expect(page.locator('.project-name strong')).toHaveText('保留当前工作区');
  const copy=page.waitForEvent('download');await preview.getByRole('button',{name:'复制原始工程包'}).click();
  const copyPath=info.outputPath('original.rcproj');await(await copy).saveAs(copyPath);expect(await readFile(copyPath)).toEqual(Buffer.from(original));
  await preview.getByRole('button',{name:/^取\s*消$/}).click();await expect(preview).not.toBeVisible();
  await expect(page.locator('.project-name strong')).toHaveText('保留当前工作区');

  await reportWorker();await page.locator('input[type=file]').first().setInputFiles(source);
  await preview.getByRole('button',{name:'打开迁移后的工程'}).click();
  const replace=page.getByRole('dialog',{name:'切换工程'});await expect(replace).toBeVisible();
  await replace.getByRole('button',{name:'打开新工程'}).click();
  await expect(page.locator('.project-name strong')).toHaveText('迁移测试工程');
  await expect(page.locator('.save-state')).toContainText('未保存');
  const saved=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const newPath=info.outputPath('migrated.rcproj');await(await saved).saveAs(newPath);
  const restored=await openProject(await readFile(newPath)),before=await openProject(original);
  expect(restored.files).toEqual(before.files);expect(restored.editor).toEqual(before.editor);
});
