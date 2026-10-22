import { projectSnapshot as snapshot } from './helpers/project';
import { expect, test, type Page } from '@playwright/test';
import { createExample } from '../../src/core/project/examples';
import { saveProject } from '../../src/core/project/archive';
import { fileById, utf8 } from '../../src/core/project/types';
const source='<robot name="workspace"><link name="base_link"><visual><geometry><box size="0.3 0.3 0.05"/></geometry></visual></link><link name="tool_link"><visual><origin xyz="0.5 0 0"/><geometry><box size="1 0.12 0.12"/></geometry><material name="blue"><color rgba="0.1 0.3 0.8 1"/></material></visual></link><joint name="joint_1" type="revolute"><parent link="base_link"/><child link="tool_link"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint></robot>';
async function open(page:Page, large=false){
  const p=createExample('igh');fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode(source+(large?'<!--'+'padding '.repeat(36000)+'-->':''));
  const buffer=Buffer.from(await saveProject(p));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'workspace.rcproj',mimeType:'application/zip',buffer});
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  await expect(page.getByLabel('机器人三维预览')).toBeVisible();await page.getByRole('button',{name:'适应模型',exact:true}).click();
  return buffer;
}
async function pick(page:Page){const canvas=page.getByLabel('机器人三维预览'),box=(await canvas.boundingBox())!;await canvas.click({position:{x:box.width/2,y:box.height/2}});}

test('3D selection reveals its path through collapsed ancestors and an obstructing tree filter',async({page},info)=>{
  await open(page);const before=await snapshot(page);
  await page.locator('.model-tree .ant-tree-switcher_open').first().click();await expect(page.getByText('joint_1 [revolute]',{exact:true})).not.toBeVisible();
  await pick(page);await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected','link:tool_link');
  await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('tool_link');await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toBeVisible();
  const search=page.getByRole('searchbox',{name:'搜索模型节点',exact:true});await search.fill('no matching nodes');
  await expect(page.getByText('joint_1 [revolute]',{exact:true})).not.toBeVisible();await pick(page);
  await expect(search).toHaveValue('');await expect(page.locator('.model-tree .ant-tree-treenode-selected')).toContainText('tool_link');
  await search.fill('tool_link');await pick(page);await expect(search).toHaveValue('tool_link');
  expect(await snapshot(page)).toBe(before);await page.screenshot({path:info.outputPath('revealed-selection.png')});
});

for(const large of [false,true])test(`ordinary limit edits retain pose and camera with ${large?'background':'synchronous'} analysis`,async({page},info)=>{
  await open(page,large);await page.getByText('joint_1 [revolute]',{exact:true}).click();
  const canvas=page.getByLabel('机器人三维预览');await canvas.evaluate(el=>el.setAttribute('data-workspace-canvas','retained'));
  await page.getByRole('button',{name:/^正\s*视$/}).click();
  const slider=page.getByRole('slider',{name:'关节预览位置',exact:true});await slider.focus();await slider.press('End');await expect(slider).toHaveAttribute('aria-valuenow','1');
  await slider.blur();await expect(page.getByRole('tooltip')).not.toBeVisible();
  const before=await canvas.screenshot({path:info.outputPath('before-edit.png')});await page.getByLabel('位置上限',{exact:true}).fill('2');await page.getByLabel('位置上限',{exact:true}).blur();
  await expect(slider).toHaveAttribute('aria-valuenow','1');if(!large)await expect(canvas).toHaveAttribute('data-workspace-canvas','retained');
  await expect.poll(async()=>Buffer.compare(before,await canvas.screenshot({path:info.outputPath('after-edit.png')}))).toBe(0);
  await page.getByLabel('位置上限',{exact:true}).fill('0.5');await page.getByLabel('位置上限',{exact:true}).blur();await expect(slider).toHaveAttribute('aria-valuenow','0.5');
  await page.getByRole('button',{name:/^撤\s*销$/}).click();await expect(slider).toHaveAttribute('aria-valuenow','0.5');
  await page.getByRole('button',{name:'重置姿态',exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','0');
  await page.screenshot({path:info.outputPath('retained-view.png')});
});

test('opening the same project identity starts a new local preview session',async({page})=>{
  const buffer=await open(page);const before=await snapshot(page);
  const slider=page.getByRole('slider',{name:'关节预览位置',exact:true});await slider.focus();await slider.press('End');await expect(slider).toHaveAttribute('aria-valuenow','1');
  expect(await snapshot(page)).toBe(before);
  await page.locator('input[type=file]').first().setInputFiles({name:'workspace.rcproj',mimeType:'application/zip',buffer});
  await page.getByRole('button',{name:'打开新工程',exact:true}).click();
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();
  await expect(slider).toHaveAttribute('aria-valuenow','0');
  expect(await snapshot(page)).toBe(before);
});
