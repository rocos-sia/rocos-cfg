import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject } from '../../src/core/project/create';
import { openProject, saveProject } from '../../src/core/project/archive';
import { ecmDocument } from '../../src/core/bus/ecm';
import { utf8 } from '../../src/core/project/types';

test('ECM forms show native scalars, derived defaults and disabled optional services without changing untouched values',async({page},info)=>{
  const p=createProject('ecm-native','ecm');p.files[0].bytes=utf8.encode('id: &n 010\nlicense: *n\nctloff: OFF\nstate: SAFEOP\n');
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'ecm.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'主站配置'}).click();
  await expect(page.getByRole('spinbutton',{name:'主站 ID',exact:true})).toHaveValue('8');
  await expect(page.getByRole('spinbutton',{name:'CPU 索引',exact:true})).toHaveValue('8');
  await expect(page.getByRole('switch',{name:'关闭 DCM 控制环'})).not.toBeChecked();
  await expect(page.getByRole('spinbutton',{name:'RAS 端口（空为禁用）',exact:true})).toHaveValue('');
  const cycle=page.getByRole('spinbutton',{name:/^通信周期\s*μs$/});
  await expect(cycle).toHaveValue('1000');await cycle.fill('2000');await cycle.blur();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('ecm.rcproj');await(await downloaded).saveAs(path);
  const restored=await openProject(await readFile(path));
  expect(ecmDocument(restored.files[0])).toMatchObject({data:{id:8,license:'010',ctloff:false,cycle:2000,cpuidx:8,state:'safeop',sp:null},diagnostics:[]});
});
