import { projectSnapshot as snapshot } from './helpers/project';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { multiaxisProject, axisNames } from '../fixtures/multiaxis';
import { openProject, saveProject } from '../../src/core/project/archive';
import { fileById, textOf } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';
import { activate, edit, navigate, tabTo } from './helpers/input';
async function english(page:import('@playwright/test').Page){
  await activate(page,page.getByRole('button',{name:'切换语言',exact:true}),'keyboard');
  const menu=page.getByRole('menu').filter({has:page.getByRole('menuitem',{name:'English',exact:true})});
  await tabTo(page,menu);await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem',{name:'English',exact:true})).toBeFocused();await page.keyboard.press('Enter');
}

for(const mode of ['keyboard','touch'] as const)test(`multiple hardware devices can be selected and edited with ${mode} without changing the wrong drive`,async({browser},info)=>{
  test.setTimeout(90000);const context=await browser.newContext({hasTouch:mode==='touch',viewport:{width:mode==='touch'?1024:1440,height:1000}}),page=await context.newPage();
  const p=multiaxisProject();await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'multi.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.locator('.project-name strong')).toHaveText(p.name);await navigate(page,'硬件与绑定',mode);
  const first=page.getByRole('radio',{name:'选择设备 4（driver）',exact:true}),second=page.getByRole('radio',{name:'选择设备 0（driver）',exact:true});
  await expect(first).toBeChecked();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toHaveValue('104');const before=await snapshot(page);
  if(mode==='keyboard'){await tabTo(page,first);await page.keyboard.press('ArrowDown');}else await second.tap();
  await expect(second).toBeChecked();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toHaveValue('100');expect(await snapshot(page)).toBe(before);
  if(mode==='touch'){
    const box=await second.locator('xpath=ancestor::label').boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  }else{
    await expect(second).toBeFocused();await page.screenshot({path:info.outputPath('device-focus.png')});
  }
  await edit(page,page.getByRole('spinbutton',{name:'ratio',exact:true}),'7',mode);
  await expect(page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true})).not.toBeChecked();
  const download=page.waitForEvent('download');await activate(page,page.getByRole('button',{name:'下载工程',exact:true}),mode);
  const path=info.outputPath('edited.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  const devices=readYaml(textOf(fileById(restored,restored.entrypoints.hardware)!)).hardware;
  expect(devices.map((d:{id:bigint;transform:{ratio:bigint}})=>[d.id,d.transform.ratio])).toEqual([[4n,104n],[0n,7n],[2n,102n]]);
  await activate(page,page.getByRole('button',{name:'撤销',exact:true}),mode);await expect(second).toBeChecked();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toHaveValue('100');
  await expect(page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true})).toBeChecked();
  if(mode==='keyboard'){
    await activate(page,page.getByRole('button',{name:'切换主题',exact:true}),mode);await tabTo(page,second);
    const wrapper=second.locator('xpath=ancestor::label');await expect(wrapper).toHaveCSS('outline-width','2px');await expect(wrapper).toHaveCSS('outline-color','rgb(147, 197, 253)');
    const original=await snapshot(page);await english(page);
    const englishDevice=page.getByRole('radio',{name:'Select device 0 (driver)',exact:true});
    await expect(englishDevice).toBeChecked();await tabTo(page,englishDevice);await expect(englishDevice).toBeFocused();expect(await snapshot(page)).toBe(original);
    const card=await page.locator('.hardware-layout>.ant-card').last().boundingBox(),workspace=await page.locator('.workspace').boundingBox();
    expect(card!.x+card!.width).toBeLessThanOrEqual(workspace!.x+workspace!.width);
    await expect(page.getByRole('button',{name:'Delete device',exact:true})).toBeInViewport();
    await page.screenshot({path:info.outputPath('device-focus-dark-en.png')});
  }
  await context.close();
});

test('branched model keyboard navigation, filtering and language changes retain node identity and preview selection',async({page},info)=>{
  test.setTimeout(90000);const p=multiaxisProject();await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'tree.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await expect(page.locator('.project-name strong')).toHaveText(p.name);await navigate(page,'机器人模型','keyboard');
  await expect(page.getByRole('tree',{name:'机器人结构树',exact:true})).toBeVisible();
  await tabTo(page,page.locator('.model-tree .ant-tree'));
  const selectNode=async(name:string)=>{for(let i=0;i<12;i++){await page.keyboard.press('ArrowDown');await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));if((await page.locator('.ant-tree-treenode-active').textContent())?.trim()===name){await page.keyboard.press('Enter');return;}}throw new Error('Tree node not reachable: '+name);};
  await selectNode(axisNames[0]+' [revolute]');
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected','joint:'+axisNames[0]);
  await page.keyboard.press('ArrowLeft');await expect(page.getByText(axisNames[1]+' [revolute]',{exact:true})).not.toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(page.getByText(axisNames[1]+' [revolute]',{exact:true})).toBeVisible();await selectNode(axisNames[1]+' [revolute]');
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected','joint:'+axisNames[1]);
  const before=await snapshot(page);
  await edit(page,page.getByRole('searchbox',{name:'搜索模型节点',exact:true}),axisNames[1],'keyboard');
  await expect(page.getByText(axisNames[1]+' [revolute]',{exact:true})).toBeVisible();
  await expect(page.getByText('fixed_branch [fixed]',{exact:true})).not.toBeVisible();
  await tabTo(page,page.locator('.model-tree .ant-tree'));await page.screenshot({path:info.outputPath('tree-focus.png')});
  await english(page);await tabTo(page,page.locator('.model-tree .ant-tree'));
  await expect(page.getByRole('tree',{name:'Robot structure tree',exact:true})).toBeVisible();
  await expect(page.getByRole('searchbox',{name:'Search model nodes',exact:true})).toHaveValue(axisNames[1]);
  await expect(page.locator('.robot-preview')).toHaveAttribute('data-selected','joint:'+axisNames[1]);expect(await snapshot(page)).toBe(before);
});
