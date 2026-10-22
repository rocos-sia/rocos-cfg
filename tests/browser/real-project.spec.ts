import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { realProjectInputs, realSourcesAvailable } from '../fixtures/real-project';
import { packZip } from '../../src/core/project/zip';
import { openProject } from '../../src/core/project/archive';
import { fileById, textOf } from '../../src/core/project/types';
import { validateProject } from '../../src/core/validation';
import { appDocument } from '../../src/core/documents/app-config';
import { buildBusCatalog } from '../../src/core/bus/catalog';
import { readRobot } from '../../src/core/documents/urdf';
import { uiOrigin } from './helpers/origin';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

for(const kind of ['ecm','igh'] as const)test(`local real ${kind} Talon project imports, repairs explicit mappings and roundtrips all assets`,async({page,browser},info)=>{
  test.skip(!realSourcesAvailable,'Set all three ROCOS_*_SOURCE paths; original inputs stay local and are never redistributed.');test.setTimeout(240000);page.setDefaultTimeout(20000);
  const {entries,corrections,sourceProof}=await realProjectInputs(kind),external:string[]=[];
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(uiOrigin))external.push(request.url());});
  expect(corrections.length).toBe(kind==='igh'?56:0);
  await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
  if(kind==='ecm'){await page.getByRole('dialog').locator('.ant-select[aria-label="主站类型"]').click();await page.getByTitle('ROCOS-ECM',{exact:true}).click();}
  await page.getByRole('button',{name:'创建工程',exact:true}).click();
  await page.locator('input[type=file][multiple]').last().setInputFiles({name:'local-inputs.zip',mimeType:'application/zip',buffer:Buffer.from(packZip(entries))});
  const preview=page.getByRole('dialog',{name:'导入预览',exact:true});await expect(preview).toBeVisible();await preview.getByRole('button',{name:'确认导入',exact:true}).click();await expect(preview).not.toBeVisible();
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
  await page.getByRole('textbox',{name:'Package 名称',exact:true}).fill('self_robot_description');await page.locator('.ant-select[aria-label="Package 目录"]').click();
  await page.locator('.ant-select-item-option[title="models/talon"]').click();await page.getByRole('button',{name:'添加包映射',exact:true}).click();
  const rawDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const rawPath=info.outputPath('unreviewed.rcproj');await(await rawDownload).saveAs(rawPath);const raw=await openProject(await readFile(rawPath));
  for(const [path,bytes]of entries)expect(sha(raw.files.find(file=>file.path===path)!.bytes),path).toBe(sha(bytes));
  expect(validateProject(raw).filter(d=>d.severity==='error').map(d=>d.code)).toEqual([...Array(kind==='igh'?63:7)].map((_,i)=>kind==='ecm'||i%9===8?'hardware.confirmation':'hardware.signal'));
  await page.getByRole('menuitem',{name:'主站配置',exact:true}).click();const cycle=page.getByRole('spinbutton',{name:/^通信周期/});await cycle.fill('1500');await cycle.blur();
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();const port=page.getByRole('spinbutton',{name:'HTTP 端口',exact:true});await port.fill('8099');await port.blur();
  await page.getByRole('menuitem',{name:'机器人模型',exact:true}).click();await page.getByText('joint_7 [continuous]',{exact:true}).click();
  const origin=page.getByRole('textbox',{name:'位置 xyz (m)',exact:true});await origin.fill('0 0.231 0');await origin.blur();
  await page.getByRole('menuitem',{name:'硬件与绑定',exact:true}).click();
  for(let id=0;id<7;id++){
    await page.getByRole('radio',{name:`选择设备 ${id}（driver）`,exact:true}).click();
    for(const change of corrections.filter(change=>change.id===id)){
      const select=page.locator('.ant-select').filter({has:page.locator(`#signal-${change.group}-${change.key}`)});
      if(change.reason==='unavailable')await select.locator('.ant-select-clear').click();
      else {await select.click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:change.to+' · '}).click();}
    }
  }
  // Exercise the review UI only. This test does not verify any physical parameter.
  for(let id=0;id<7;id++){await page.getByRole('radio',{name:`选择设备 ${id}（driver）`,exact:true}).click();await page.getByRole('checkbox',{name:'已人工核对换算、零点与限位',exact:true}).check();}
  const memory=await page.evaluate(async()=>{
    const path='/src/store.ts';const {useProject}=await import(path);const state=useProject.getState(),project=state.project;
    if(!project||document.querySelector('.shell')?.getAttribute('data-project-id')!==project.id)throw Error('Stale project store');
    const assets=project.files.filter((file:{role:string})=>file.role==='resource'),snapshots=[...state.past,project];
    return {assetsBytes:assets.reduce((sum:number,file:{bytes:Uint8Array})=>sum+file.bytes.length,0),undoSteps:state.past.length,maxCopies:Math.max(...assets.map((file:{id:string})=>new Set(snapshots.flatMap((snapshot:{files:{id:string;bytes:Uint8Array}[]})=>snapshot.files.filter(other=>other.id===file.id).map(other=>other.bytes.buffer))).size))};
  });
  expect(memory.assetsBytes).toBeGreaterThan(40*1024*1024);expect(memory.maxCopies).toBe(1);if(kind==='igh')expect(memory.undoSteps).toBe(40);
  const saved=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const archivePath=info.outputPath('test-reviewed.rcproj');await(await saved).saveAs(archivePath);
  const savedBytes=await readFile(archivePath),restored=await openProject(savedBytes);expect(validateProject(restored).filter(d=>d.severity==='error').map(d=>d.code)).toEqual([]);if(kind==='igh')expect(validateProject(restored).filter(d=>d.code==='hardware.torque-input')).toHaveLength(7);
  expect(readRobot(textOf(fileById(restored,restored.entrypoints.urdf)!)).joints.find(joint=>joint.name==='joint_7')?.xyz).toBe('0 0.231 0');
  for(const [path,bytes]of entries)if(![kind+'.yaml','hardware_talon_config.yaml','config.yaml','robot.urdf'].includes(path.split('/').at(-1)!))expect(sha(restored.files.find(file=>file.path===path)!.bytes),path).toBe(sha(bytes));
  expect(buildBusCatalog(restored).cycleUs).toBe(1500);expect(appDocument(fileById(restored,restored.entrypoints.app)!).data.http_port).toBe(8099);
  const fresh=await browser.newContext(),reopened=await fresh.newPage();await reopened.goto(uiOrigin);await reopened.locator('input[type=file]').first().setInputFiles(archivePath);
  await reopened.getByRole('menuitem',{name:'校验与导出',exact:true}).click();await reopened.getByRole('button',{name:'检查并导出配置',exact:true}).click();
  const plan=reopened.getByRole('dialog',{name:'运行包导出计划',exact:true});await expect(plan).toBeVisible();const runtimeDownload=reopened.waitForEvent('download');await plan.getByRole('button',{name:'下载运行包',exact:true}).click();
  const runtimePath=info.outputPath('TEST-ONLY-runtime.zip');await(await runtimeDownload).saveAs(runtimePath);const runtime=unzipSync(await readFile(runtimePath));
  expect(runtime['rocos-project.json']).toBeUndefined();expect(Object.keys(runtime).some(path=>path.startsWith('project-data/'))).toBe(false);
  for(const [path,bytes]of entries)if(/^(?:web\/|config\/scripts\/|models\/talon\/meshes\/)/.test(path)||path==='master/eni7.xml')expect(sha(runtime[path]),path).toBe(sha(bytes));
  const originalXml=new TextDecoder().decode(entries.get('models/talon/robot.urdf')),runtimeXml=new TextDecoder().decode(runtime['models/talon/robot.urdf']);
  expect(runtimeXml.match(/<hardware\b[^>]*>[\s\S]*?<\/hardware>/g)).toEqual(originalXml.match(/<hardware\b[^>]*>[\s\S]*?<\/hardware>/g));
  expect(readRobot(runtimeXml).joints.find(joint=>joint.name==='joint_7')?.xyz).toBe('0 0.231 0');
  await writeFile(info.outputPath('report.json'),JSON.stringify({kind,sourceProof,inputFiles:entries.size,inputHashes:Object.fromEntries([...entries].map(([path,bytes])=>[path,sha(bytes)])),corrections,memory,runtimeFiles:Object.keys(runtime).length,scope:'Local automation of import/edit/review/archive/export only. Review checkboxes and optional feedback removals are test actions, not physical parameter or SDK validation. IgH without load torque feedback retains a warning that the APP read returns zero. unreviewed.rcproj retains the real outstanding review requirements.'},null,2));
  await fresh.close();expect(external).toEqual([]);
});
