import { uiOrigin } from './helpers/origin';
import { activate, edit, navigate, tabTo } from './helpers/input';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { openProject } from '../../src/core/project/archive';
import { fileById, textOf } from '../../src/core/project/types';
import { readYaml } from '../../src/core/documents/yaml';

for(const kind of ['igh','ecm'] as const)for(const mode of ['keyboard','touch'] as const)test(`${kind} teaching example completes edit, archive, fresh-context reopen and runtime export with ${mode}`,async({browser},info)=>{
  test.setTimeout(90000);
  const opts={viewport:mode==='touch'?{width:1024,height:900}:{width:1440,height:1000},hasTouch:mode==='touch'};
  const context=await browser.newContext(opts),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await activate(page,page.getByRole('button',{name:'打开示例',exact:true}),mode);
  await activate(page,page.getByRole('button',{name:kind==='igh'?'打开 IgH 示例':'打开 EC-Master 示例',exact:true}),mode);
  await expect(page.getByText('教学示例',{exact:true})).toBeVisible();
  await navigate(page,'主站配置',mode);await edit(page,page.getByRole('spinbutton',{name:/^通信周期/}),'2000',mode);
  await navigate(page,'机器人模型',mode);
  if(mode==='touch')await page.getByText('joint_1 [revolute]',{exact:true}).tap();
  else{await tabTo(page,page.locator('.model-tree .ant-tree'));await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
  const properties=page.getByRole('tab',{name:'属性',exact:true});
  if(await properties.isVisible()){
    if(mode==='touch')await properties.tap();
    else{await tabTo(page,page.getByRole('tablist',{name:'模型面板',exact:true}));await page.keyboard.press('End');}
  }
  await edit(page,page.getByRole('textbox',{name:'位置 xyz (m)',exact:true}),'0 0 0.1',mode);
  await navigate(page,'APP 配置',mode);await edit(page,page.getByRole('spinbutton',{name:'HTTP 端口',exact:true}),'8099',mode);
  await navigate(page,'硬件与绑定',mode);await edit(page,page.getByRole('spinbutton',{name:'ratio',exact:true}),'2',mode);
  const approval=page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true});await expect(approval).not.toBeChecked();
  if(mode==='touch')await approval.tap();else{await tabTo(page,approval);await page.keyboard.press('Space');}
  await expect(approval).toBeChecked();
  const downloading=page.waitForEvent('download');await activate(page,page.getByRole('button',{name:'下载工程',exact:true}),mode);
  const path=info.outputPath(`${kind}-${mode}.rcproj`);await(await downloading).saveAs(path);
  const p=await openProject(await readFile(path));const master=readYaml(textOf(fileById(p,p.entrypoints.master.fileId)!));expect(kind==='igh'?master.master.period_us:master.cycle).toBe(2000n);
  expect(readYaml(textOf(fileById(p,p.entrypoints.app)!)).http_port).toBe(8099n);
  expect(textOf(fileById(p,p.entrypoints.urdf)!)).toContain('xyz="0 0 0.1"');
  expect(readYaml(textOf(fileById(p,p.entrypoints.hardware)!)).hardware[0].transform.ratio).toBe(2n);
  const eni=kind==='ecm'?fileById(p,p.entrypoints.master.eniFileId)!.bytes:undefined;
  await context.close();
  // A separate storage/cache context on this host: this does not claim a second computer.
  const fresh=await browser.newContext(opts),reopened=await fresh.newPage();await reopened.goto(uiOrigin);
  const choosing=reopened.waitForEvent('filechooser');await activate(reopened,reopened.getByRole('button',{name:'打开工程',exact:true}),mode);await(await choosing).setFiles(path);
  await expect(reopened.locator('.project-name strong')).toHaveText(p.name);
  await navigate(reopened,'主站配置',mode);await expect(reopened.getByRole('spinbutton',{name:/^通信周期/})).toHaveValue('2000');
  await navigate(reopened,'校验与导出',mode);await activate(reopened,reopened.getByRole('button',{name:'检查并导出配置',exact:true}),mode);
  await expect(reopened.getByRole('dialog',{name:'运行包导出计划'})).toBeVisible();
  const runtime=reopened.waitForEvent('download');await activate(reopened,reopened.getByRole('button',{name:'下载运行包',exact:true}),mode);
  const runtimePath=info.outputPath(`${kind}-${mode}-runtime.zip`);await(await runtime).saveAs(runtimePath);const entries=unzipSync(await readFile(runtimePath));
  expect(entries[`master/${kind}.yaml`]).toBeDefined();expect(Object.keys(entries).some(p=>p.startsWith('project-data/'))).toBe(false);
  expect(readYaml(new TextDecoder().decode(entries['app/config.yaml'])).http_port).toBe(8099n);
  if(eni)expect(entries['master/eni.xml']).toEqual(eni);
  expect(errors).toEqual([]);await reopened.screenshot({path:info.outputPath(`${kind}-${mode}.png`)});await fresh.close();
});
