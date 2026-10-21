import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resourceProject } from '../fixtures/resources';
import { openProject, saveProject } from '../../src/core/project/archive';
import { appDocument } from '../../src/core/documents/app-config';
import { fileById, textOf, utf8 } from '../../src/core/project/types';

test('APP fields show native values and missing defaults, and editing preserves shared scalar anchors',async({page},info)=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.app)!;
  file.bytes=utf8.encode(textOf(file).replace('http_host: 0.0.0.0','http_host: &n 010').replace('http_port: 8080','http_port: *n').replace('http_control_ttl_seconds: 300\n',''));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'app-native.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'APP 配置',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'HTTP 监听地址',exact:true})).toHaveValue('010');
  await expect(page.getByRole('spinbutton',{name:'HTTP 端口',exact:true})).toHaveValue('8');
  const ttl=page.getByRole('spinbutton',{name:/^控制权 TTL\s*s$/});await expect(ttl).toHaveValue('300');
  await ttl.fill('600');await ttl.blur();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('app-native.rcproj');await(await download).saveAs(path);
  const restored=await openProject(await readFile(path)),app=fileById(restored,restored.entrypoints.app)!;
  expect(appDocument(app).data).toMatchObject({http_host:'010',http_port:8,http_control_ttl_seconds:600});
  expect(textOf(app)).toContain('*n');
});
