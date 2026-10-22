import { projectSnapshot as snapshot } from './helpers/project';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { planRobotChange } from '../../src/core/documents/robot-edit';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf, utf8 } from '../../src/core/project/types';

// Exercise a locale update while a modal has focus; do not click through its mask.
async function locale(page:Page,value:'zh-CN'|'en-US'){
  await page.evaluate(async next=>{const path='/src/i18n/index.ts';const module=await import(path);module.setLocale(next);},value);
}
function namedProject(){return planRobotChange(resourceProject(),{kind:'rename',node:'joint',name:'joint',value:'工程总览-{v0}'}).project;}

test('updates a pending model plan and retains translated review notices through save and reopen',async({page,context},info)=>{
  const p=namedProject(),file=fileById(p,p.entrypoints.urdf)!;
  const legacy='<hardware target="工程总览-{v0}"><joint name="工程总览-{v0}"/></hardware>';
  file.bytes=utf8.encode(textOf(file).replace('</robot>','<custom target="工程总览-{v0}"/>'+legacy+'</robot>'));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'review.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  await page.getByText('工程总览-{v0} [revolute]',{exact:true}).click();
  await page.getByRole('button',{name:'重命名节点',exact:true}).click();await page.getByLabel('节点新名称',{exact:true}).fill('工具');
  await page.getByRole('button',{name:'查看变更',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'确认模型与引用变更'})).toContainText('控制链：工程总览-{v0} → 工具；请复核绑定。');
  await locale(page,'en-US');
  const dialog=page.getByRole('dialog',{name:'Confirm model and reference changes'});
  await expect(dialog).toContainText('Control chain: 工程总览-{v0} → 工具; review bindings.');
  const notice='Keep extension/unknown reference <custom target="工程总览-{v0}"> unchanged; review required.';
  await expect(dialog).toContainText(notice);
  await expect(dialog).not.toContainText('<hardware');
  await dialog.getByRole('button',{name:'Apply model changes',exact:true}).click();
  await expect(page.getByText('工具 [revolute]',{exact:true})).toBeVisible();
  await expect(page.getByRole('main').getByText(notice,{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download project',exact:true}).click();
  const path=info.outputPath('review.rcproj');await(await download).saveAs(path);const bytes=await readFile(path);
  const restored=await openProject(bytes),expected=planRobotChange(p,{kind:'rename',node:'joint',name:'工程总览-{v0}',value:'工具'}).project;
  expect(restored.files).toEqual(expected.files);
  // Applying a document change invalidates the prior mechanical approval in the store.
  expect(restored.editor).toEqual({...expected.editor,confirmations:{}});
  const reopened=await context.newPage();await reopened.goto('/');await reopened.getByRole('dialog',{name:'Local recovery drafts'}).getByRole('button',{name:'Not now',exact:true}).click();await reopened.locator('input[type=file]').first().setInputFiles({name:'review.rcproj',mimeType:'application/zip',buffer:bytes});
  await reopened.getByRole('menuitem',{name:'Robot model',exact:true}).click();await expect(reopened.getByText(notice,{exact:true})).toBeVisible();
  await locale(reopened,'zh-CN');await expect(reopened.getByText('扩展/未识别引用 <custom target="工程总览-{v0}"> 保持原文，请核对。',{exact:true})).toBeVisible();
  await reopened.close();
});

test('updates hardware and slave impact dialogs without changing the proposed transaction, and preserves undo',async({page},info)=>{
  const p=namedProject();await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'impacts.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'硬件与绑定',exact:true}).click();await page.getByRole('button',{name:'删除设备',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'确认硬件变更'})).toContainText('工程总览-{v0}：移除绑定');
  await locale(page,'en-US');const hardware=page.getByRole('dialog',{name:'Confirm hardware changes'});
  await expect(hardware).toContainText('工程总览-{v0}: Remove binding');await hardware.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Delete device',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Master',exact:true}).click();await page.getByRole('tab',{name:'Edit PDO / SDO',exact:true}).click();await page.getByRole('button',{name:'Delete slave',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Confirm slave and binding changes'})).toContainText('Remove joint_bindings entry 0 (工程总览-{v0})');
  await locale(page,'zh-CN');const slave=page.getByRole('dialog',{name:'确认从站及绑定变更'});
  await expect(slave).toContainText('移除 joint_bindings 条目 0（工程总览-{v0}）');await slave.getByRole('button',{name:'应用变更',exact:true}).click();
  await expect(page.getByRole('button',{name:'删除从站',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('button',{name:'删除从站',exact:true})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('unchanged.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  expect(restored.files).toEqual(p.files);expect(restored.editor).toEqual(p.editor);
});

for(const kind of ['hardware','slave','robot'] as const)test(`${kind} plan cannot overwrite a replacement workspace with the same UUID and revision`,async({page},info)=>{
  const p=namedProject();await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'stale.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  if(kind==='hardware'){
    await page.getByRole('menuitem',{name:'硬件与绑定',exact:true}).click();await page.getByRole('button',{name:'删除设备',exact:true}).click();
  }else if(kind==='slave'){
    await page.getByRole('menuitem',{name:'主站配置',exact:true}).click();await page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true}).click();await page.getByRole('button',{name:'删除从站',exact:true}).click();
  }else{
    await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();await page.getByText('工程总览-{v0} [revolute]',{exact:true}).click();
    await page.getByRole('button',{name:'重命名节点',exact:true}).click();await page.getByLabel('节点新名称',{exact:true}).fill('不应写入');await page.getByRole('button',{name:'查看变更',exact:true}).click();
  }
  const name=kind==='hardware'?'确认硬件变更':kind==='slave'?'确认从站及绑定变更':'确认模型与引用变更';
  const dialog=page.getByRole('dialog',{name});await expect(dialog).toBeVisible();
  // Simulate a session replacement after preview; UUID/revision alone do not identify a workspace.
  await snapshot(page);
  await page.evaluate(async()=>{const path='/src/store.ts';const {useProject}=await import(path);const next=structuredClone(useProject.getState().project);next.name='同 ID 新工程';useProject.getState().load(next);});
  if(kind==='robot'){
    // Robot's session key discards its pending plan together with the old view.
    await expect(dialog).not.toBeVisible();
  }else{
    await dialog.getByRole('button',{name:'应用变更',exact:true}).click();
    await expect(page.getByText(/工程已变化，请重新/)).toBeVisible();
    await dialog.getByRole('button',{name:/^取\s*消$/}).click();
  }
  await expect(page.locator('.project-name strong')).toHaveText('同 ID 新工程');
  await snapshot(page);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('replacement.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  expect(restored.name).toBe('同 ID 新工程');expect(restored.files).toEqual(p.files);expect(restored.editor).toEqual(p.editor);
});
