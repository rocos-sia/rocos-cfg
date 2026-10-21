// Test the actual ZIP, with a fresh browser and a server launched from the
// extracted distribution. The extracted application has no node_modules.
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';
import { chromium, expect } from '@playwright/test';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
const temporary = await mkdtemp(resolve(tmpdir(), 'rocos-package-'));
let server;
let browser;
try {
  const archive = unzipSync(new Uint8Array(await readFile('artifacts/rocos-configurator-offline.zip')));
  const version = (await readFile('VERSION', 'utf8')).trim();
  expect(new TextDecoder().decode(archive['rocos-configurator/VERSION']).trim()).toBe(version);
  for (const [name, data] of Object.entries(archive)) {
    const path = resolve(temporary, name);
    if (!path.startsWith(temporary + sep)) throw new Error('Invalid distribution entry');
    if (name.endsWith('/')) { await mkdir(path, { recursive: true }); continue; }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  server = spawn(process.execPath, ['scripts/serve-static.mjs', '--port', '0'], {
    cwd: resolve(temporary, 'rocos-configurator'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = await new Promise((resolveAddress, reject) => {
    const timer = setTimeout(() => reject(new Error('Offline server did not start')), 10000);
    let output = '';
    server.stdout.on('data', data => {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolveAddress(match[0]); }
    });
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Offline server exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext();
  const external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(address)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(address);
  await expect(page.locator('.sidebar-bottom small')).toHaveText(version);
  await expect(page.getByRole('button', { name: '新建工程', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('menuitem', { name: '主站配置' }).click();
  await page.getByLabel('通信周期').fill('5000');
  await page.getByLabel('通信周期').blur();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载工程', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.rcproj$/);
  const project = unzipSync(new Uint8Array(await readFile(await file.path())));
  const manifest = JSON.parse(new TextDecoder().decode(project['rocos-project.json']));
  expect(manifest.lastSavedWith.version).toBe(version);
  expect(manifest.entrypoints.master.kind).toBe('igh');
  const master = manifest.files.find(entry => entry.id === manifest.entrypoints.master.fileId);
  expect(parse(new TextDecoder().decode(project[master.path])).master.period_us).toBe(5000);
  for (const entry of manifest.files) {
    expect(project[entry.path].length).toBe(entry.size);
    expect(createHash('sha256').update(project[entry.path]).digest('hex')).toBe(entry.sha256);
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  console.log(`Offline ZIP ${version} verified: cold start, persisted edit and archive hashes without external requests.`);
} finally {
  await browser?.close();
  server?.kill();
  await rm(temporary, { recursive: true, force: true });
}
