import { parse as parseYaml } from 'yaml';
// Exercises the actual Linux WebKit application and GTK file dialogs inside an
// isolated X server. No test-only file commands are compiled into the app.
import { spawn, execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createServer as createViteServer } from 'vite';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const binary=resolve(process.env.ROCOS_DESKTOP_BINARY||'src-tauri/target/debug/rocos-configurator');
const expectedVersion=(await readFile('VERSION','utf8')).trim();
const artifacts=resolve('test-results/desktop');await rm(artifacts,{recursive:true,force:true});await mkdir(artifacts,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'rocos-desktop-ui-'));
const children=[];let session,driverUrl,browser;
let env={...process.env,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',XDG_DATA_HOME:join(temp,'data'),XDG_CACHE_HOME:join(temp,'cache'),XDG_CONFIG_HOME:join(temp,'config'),XDG_RUNTIME_DIR:join(temp,'runtime'),WEBKIT_DISABLE_DMABUF_RENDERER:'1',GTK_USE_PORTAL:'0'};
await mkdir(env.XDG_RUNTIME_DIR,{mode:0o700});
const log=[];
const start=(command,args,options={})=>{const child=spawn(command,args,{env,detached:true,stdio:['ignore','pipe','pipe'],...options});children.push(child);child.on('error',e=>log.push(`${command}: ${e.message}\n`));for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>log.push(b.toString()));return child;};
function executable(name){
  const paths=name.includes('/')?[resolve(name)]:(env.PATH||'').split(delimiter).map(dir=>resolve(dir,name));
  for(const path of paths){try{accessSync(path,constants.X_OK);return path;}catch{}}
  throw new Error(`Required desktop test executable not found: ${name}`);
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,timeout=30000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){error=e;}await pause(150);}throw new Error(`Timed out: ${label}${error?' ('+error.message+')':''}`);}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function request(method,path,body){
  try {
    const r=await fetch(driverUrl+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    const v=await r.json();if(!r.ok||v.value?.error)throw new Error(JSON.stringify(v));return v.value;
  } catch(error) {
    throw new Error(`WebDriver ${method} ${path}${body?.script?' ['+body.script.slice(0,180)+']':''}: ${error.message}`,{cause:error});
  }
}
const script=(code,args=[])=>request('POST',`/session/${session}/execute/sync`,{script:code,args});
const pointerClick=async(selector)=>{
  const point=await script(`const e=document.querySelector(arguments[0]);if(!e)throw Error('Missing pointer target');const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden pointer target');return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`,[selector]);
  await request('POST',`/session/${session}/actions`,{actions:[{type:'pointer',id:'native-pointer',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:'viewport',duration:0,...point},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
};
const text=()=>script('return document.body.innerText');
const visibleText=target=>wait(async()=>(await text()).includes(target),target);
const click=async(label)=>{await wait(()=>script(`const el=[...document.querySelectorAll('button')].find(e=>e.offsetParent&&e.textContent.replace(/\\s/g,'')===arguments[0].replace(/\\s/g,''));if(!el||el.disabled)return false;el.click();return true;`,[label]),'click '+label);};
const menu=label=>script(`const el=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===arguments[0]);if(!el)throw Error('menu missing');el.click();`,[label]);
async function language(value){
  // Dispatch the real language control while a controlled modal is open; no
  // application state or test-only native command is injected.
  await script(`document.querySelector('button[aria-label="切换语言"],button[aria-label="Change language"]').click();`);
  await wait(()=>script(`const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===arguments[0]);if(!e)return false;e.click();return true;`,[value==='en-US'?'English':'简体中文']),'language menu');
  await wait(()=>script('return document.documentElement.lang===arguments[0]',[value]),'language '+value);
}
async function rename(value){await menu('工程总览');await wait(()=>script(`const e=document.querySelector('.overview-grid input');if(!e)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,arguments[0]);e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.blur();return true;`,[value]),'rename');await visibleText(value);}
const xdotool=(...args)=>execFileSync(process.env.XDOTOOL||'xdotool',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
async function picker(path,title,replaceExisting=false){
  const win=await wait(()=>{try{return xdotool('search','--onlyvisible','--name','^'+title+'$').split('\n')[0];}catch{return false;}},'native '+title);
  const location=path;
  xdotool('windowactivate','--sync',win);
  if(title==='Select Folder'){xdotool('key','--clearmodifiers','alt+Home');await pause(300);}
  xdotool('key','--clearmodifiers',title==='Select Folder'?'slash':'ctrl+l');await pause(300);
  xdotool('key','--clearmodifiers','ctrl+a');xdotool('type','--clearmodifiers','--delay','1',location);
  // GTK resolves the typed location asynchronously before accepting it.
  await pause(800);
  // Remove only an inline completion selection; with no selection Delete at
  // the end leaves the typed path unchanged. A '/.' suffix is not equivalent
  // in GTK's folder-entry parser and may select the parent directory.
  if(title==='Select Folder')xdotool('key','--clearmodifiers','Delete');
  xdotool('key','--clearmodifiers','Return');await pause(800);
  if(replaceExisting){try{if(xdotool('search','--onlyvisible','--name','^'+title+'$').split('\n').includes(win)){xdotool('key','--clearmodifiers','alt+r');await pause(800);}}catch{}}
  try{if(xdotool('search','--onlyvisible','--name','^'+title+'$').split('\n').includes(win))xdotool('key','--clearmodifiers',title==='Save File'?'alt+s':'alt+o');}catch{}
  await wait(()=>{try{return !xdotool('search','--onlyvisible','--name','^'+title+'$').split('\n').includes(win);}catch{return true;}},'native dialog closes').catch(e=>{try{execFileSync('import',['-window','root',join(artifacts,'native-dialog-failure.png')],{env,stdio:'ignore',timeout:5000});}catch{}throw e;});
}
const manifest=async path=>JSON.parse(new TextDecoder().decode(unzipSync(await readFile(path))['rocos-project.json']));
try {
  const xvfb=start(process.env.XVFB||'Xvfb',['-displayfd','3','-screen','0','1440x1000x24','-nolisten','tcp'],{stdio:['ignore','pipe','pipe','pipe']});
  const display=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Xvfb did not start')),15000);xvfb.stdio[3].once('data',b=>{clearTimeout(timeout);resolve(b.toString().trim());});xvfb.once('error',reject);});env={...env,DISPLAY:':'+display};
  start(executable(process.env.WINDOW_MANAGER||'openbox'),['--sm-disable']);
  await wait(()=>{try{xdotool('getactivewindow');return true;}catch{return false;}},'window manager',5000).catch(()=>{});
  const port=await freePort(),nativePort=await freePort();driverUrl=`http://127.0.0.1:${port}`;
  const driver=start('dbus-run-session',['--',executable(process.env.TAURI_DRIVER||'tauri-driver'),'--port',String(port),'--native-port',String(nativePort),'--native-driver',executable(process.env.WEBKIT_WEBDRIVER||'WebKitWebDriver')]);
  await wait(async()=>{try{const r=await fetch(driverUrl+'/status');return r.ok;}catch{return false;}},'tauri-driver');
  const created=await request('POST','/session',{capabilities:{alwaysMatch:{'tauri:options':{application:binary}}}});session=created.sessionId;
  await visibleText('新建工程');assert.equal(await script('return window.isSecureContext && !!window.crypto.subtle'),true);
  assert.equal(await script("return document.querySelector('.sidebar-bottom small').textContent"),expectedVersion);
  await visibleText('桌面离线版');await click('新建工程');await click('创建工程');await visibleText('工程总览');await rename('desktop-original');
  const original=join(temp,'original.rcproj'),savedAs=join(temp,'saved-as.rcproj'),copy=join(temp,'copy.rcproj');
  await click('保存工程');await picker(original,'Save File');await visibleText('已保存工程文件');
  assert.equal((await manifest(original)).project.name,'desktop-original');const first=await readFile(original);
  assert.equal((await manifest(original)).lastSavedWith.version,expectedVersion);
  console.log('Desktop: initial native save passed.');
  await rename('desktop-edited');await click('保存工程');await visibleText('已保存工程文件');
  const backups=(await readdir(temp)).filter(x=>x.startsWith('original-backup-'));assert.equal(backups.length,1);assert.deepEqual(await readFile(join(temp,backups[0])),first);
  await language('en-US');
  await wait(()=>script(`return [...document.querySelectorAll('.ant-message-notice')].some(e=>e.textContent.includes(arguments[0]));`,['Previous version backup: '+join(temp,backups[0])]),'English backup notification');
  await language('zh-CN');
  await wait(()=>script(`return [...document.querySelectorAll('.ant-message-notice')].some(e=>e.textContent.includes(arguments[0]));`,['上一版备份：'+join(temp,backups[0])]),'Chinese backup notification');
  const external=unzipSync(await readFile(original)),m=JSON.parse(new TextDecoder().decode(external['rocos-project.json']));m.project.name='external-edit';external['rocos-project.json']=new TextEncoder().encode(JSON.stringify(m));await writeFile(original,zipSync(external));const externalBytes=await readFile(original);
  await rename('local-edits');await click('保存工程');await visibleText('磁盘文件已变化');assert.deepEqual(await readFile(original),externalBytes);
  await language('en-US');await visibleText('The file was changed or deleted externally');
  await click('Compare disk version');await visibleText('Disk project: external-edit');await visibleText('Identical');
  await wait(()=>script("return !document.querySelector('.ant-message-notice');"),'prior save notifications dismissed',10000);
  // WebKitWebDriver may stall taking a screenshot after the view becomes idle.
  // Capture the actual X11 application window; retain all DOM assertions above.
  const conflictWindow=xdotool('search','--onlyvisible','--name','^ROCOS Configurator$').split('\n')[0];
  execFileSync('import',['-window',conflictWindow,join(artifacts,'desktop-conflict-en.png')],{env,stdio:'pipe',timeout:10000});
  await language('zh-CN');await visibleText('磁盘工程：external-edit');await visibleText('文件已被外部修改或删除');
  assert.deepEqual(await readFile(original),externalBytes);
  // Select the modal Save As, not the toolbar button with the same label.
  await script(`const d=[...document.querySelectorAll('[role=dialog]')].find(e=>e.textContent.includes('磁盘文件已变化'));[...d.querySelectorAll('button')].find(e=>e.textContent.trim()==='另存为').click();`);
  await picker(savedAs,'Save File');await visibleText('已保存工程文件');assert.equal((await manifest(savedAs)).project.name,'local-edits');assert.deepEqual(await readFile(original),externalBytes);
  console.log('Desktop: overwrite backup, bilingual external conflict/difference view and Save As passed.');
  const resources=join(temp,'resources');await mkdir(join(resources,'nested'),{recursive:true});await writeFile(join(resources,'nested','notes.txt'),'native directory bytes');
  await menu('APP 配置');await visibleText('导入资源目录');await click('导入资源目录');await picker(resources,'Select Folder');await visibleText('导入预览');await click('确认导入');await click('保存工程');await visibleText('已保存工程文件');
  assert.ok((await manifest(savedAs)).files.some(f=>f.path==='nested/notes.txt'));
  await menu('校验与导出');await click('导出工程副本');await picker(copy,'Save File');await visibleText('工程副本已写入磁盘');const copyBytes=await readFile(copy);
  const fork=join(temp,'new-project.rcproj');await click('复制为新工程');await picker(fork,'Save File');await visibleText('新工程已写入磁盘');
  const copied=await manifest(copy),forked=await manifest(fork),forkBytes=await readFile(fork);
  assert.equal(copied.project.id,(await manifest(savedAs)).project.id);assert.notEqual(forked.project.id,copied.project.id);
  assert.notEqual(forked.snapshotId,copied.snapshotId);assert.equal(forked.project.revision,0);
  assert.deepEqual(forked.files,copied.files);assert.equal(forked.project.name,'local-edits（副本）');
  await rename('after-copy');await click('保存工程');await visibleText('已保存工程文件');assert.equal((await manifest(savedAs)).project.name,'after-copy');assert.deepEqual(await readFile(copy),copyBytes);
  assert.deepEqual(await readFile(fork),forkBytes);
  console.log('Desktop: native directory import, same-UUID copy and new independent project passed.');
  const screen=await request('GET',`/session/${session}/screenshot`);await writeFile(join(artifacts,'desktop-saved.png'),Buffer.from(screen,'base64'));
  // Open the desktop archive in an ordinary browser, edit it, then reopen that
  // browser-produced archive through the native GTK open dialog.
  const webPort=await freePort();start(process.execPath,['scripts/serve-static.mjs','--port',String(webPort)]);
  const webUrl=`http://127.0.0.1:${webPort}/`;await wait(async()=>{try{return (await fetch(webUrl)).ok;}catch{return false;}},'static browser server');
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});const page=await browser.newPage();
  await page.route('**/*',route=>route.request().url().startsWith(webUrl)?route.continue():route.abort());
  await page.goto(webUrl);await page.locator('input[type=file]').first().setInputFiles(savedAs);await page.locator('.overview-grid input').fill('browser-return');await page.locator('.overview-grid input').blur();
  const largeUrdf='<robot name="desktop-worker"><link name="base_link"><visual><geometry><box size="0.3 0.3 0.05"/></geometry></visual></link><link name="worker_tip"><visual><origin xyz="0.5 0 0"/><geometry><box size="1 0.12 0.12"/></geometry></visual></link><joint name="worker_axis" type="revolute"><parent link="base_link"/><child link="worker_tip"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" velocity="1" effort="10"/></joint></robot>\n<!--'+'padding '.repeat(36000)+'-->';
  await page.locator('input[type=file][multiple]').setInputFiles({name:'robot.urdf',mimeType:'application/xml',buffer:Buffer.from(largeUrdf)});
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const returned=join(temp,'browser-return.rcproj');await(await downloaded).saveAs(returned);await browser.close();browser=undefined;
  await click('打开工程');await picker(returned,'Open File');await visibleText('切换工程');await click('打开新工程');await visibleText('browser-return');
  await writeFile(join(artifacts,'desktop-roundtrip.rcproj'),await readFile(returned));
  console.log('Desktop and browser .rcproj roundtrip passed.');
  await menu('机器人模型');await visibleText('Link / Joint 结构');
  await visibleText('worker_tip');assert.ok((await manifest(returned)).files.find(f=>f.role==='urdf').size>256*1024);
  await wait(()=>script(`const c=document.querySelector('canvas[aria-label="机器人三维预览"]');return !!c&&c.width>0&&c.height>0&&c.getContext('webgl2')?.isContextLost()===false;`),'native WebGL model viewport');
  assert.equal((await text()).includes('模型预览失败'),false);
  await writeFile(join(artifacts,'desktop-model.png'),Buffer.from(await request('GET',`/session/${session}/screenshot`),'base64'));
  await click('适应模型');
  await script(`document.querySelector('.model-tree .ant-tree-switcher_open').click();`);
  const center=await script(`const r=document.querySelector('canvas[aria-label="机器人三维预览"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
  await request('POST',`/session/${session}/actions`,{actions:[{type:'pointer',id:'model-pick',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:'viewport',duration:0,...center},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
  await wait(()=>script(`return document.querySelector('.robot-preview')?.dataset.selected==='link:worker_tip'&&document.querySelector('.model-tree .ant-tree-treenode-selected')?.textContent.includes('worker_tip');`),'native collapsed tree reveals picked link');
  await script(`const e=[...document.querySelectorAll('.model-tree .ant-tree-title')].find(e=>e.textContent==='worker_axis [revolute]');e.click();`);
  await click('正视');
  await script(`document.querySelector('[role=slider][aria-label="关节预览位置"]').focus();`);xdotool('key','--clearmodifiers','End');
  await wait(()=>script(`return document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')==='1';`),'native preview pose');
  for(const [upper,expected] of [['2','1'],['0.5','0.5']]){
    await script(`document.querySelector('#joint-upper').focus();`);
    xdotool('key','--clearmodifiers','ctrl+a');xdotool('type','--clearmodifiers',upper);xdotool('key','--clearmodifiers','Tab');
    await wait(()=>script(`return document.querySelector('#joint-upper')?.value===arguments[0]&&document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')===arguments[1];`,[upper,expected]),'native pose retained/clamped at upper '+upper);
  }
  await click('撤销');await wait(()=>script(`return document.querySelector('#joint-upper')?.value==='2'&&document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')==='0.5';`),'native undo preserves local pose');
  await click('重置姿态');await wait(()=>script(`return document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')==='0';`),'native reset pose');
  console.log('Desktop: 3D selection reveals collapsed tree; limit editing and undo retain/clamp local pose.');
  await rename('unsaved-close-check');
  const window=xdotool('search','--onlyvisible','--name','^ROCOS Configurator$').split('\n')[0];
  xdotool('windowactivate','--sync',window);xdotool('key','--clearmodifiers','alt+F4');await visibleText('当前工程有未保存修改');
  await language('en-US');await visibleText('Close application');await visibleText('Close without saving');await click('Cancel');await visibleText('unsaved-close-check');await language('zh-CN');
  assert.equal((await manifest(returned)).project.name,'browser-return');
  console.log('Desktop: large URDF background parsing, WebGL viewport and cancelled unsaved-close confirmation passed.');
  const damagedPath=join(temp,'damaged.rcproj'),damagedEntries=unzipSync(await readFile(returned));
  const damagedManifest=JSON.parse(new TextDecoder().decode(damagedEntries['rocos-project.json']));
  const appPath=damagedManifest.files.find(f=>f.id===damagedManifest.entrypoints.app).path;
  damagedEntries[appPath]=new TextEncoder().encode('corrupted APP content');
  const damagedBytes=zipSync(damagedEntries);await writeFile(damagedPath,damagedBytes);
  await click('打开工程');await picker(damagedPath,'Open File');await visibleText('工程完整性检查失败');
  await click('检查可恢复文件');await visibleText('创建恢复工程');await click('创建恢复工程');await visibleText('切换工程');await click('打开新工程');await visibleText('browser-return（恢复）');
  await language('en-US');await click('Save project');await picker(damagedPath,'Save File',true);await visibleText('Choose another path; the current project or protected original archive cannot be overwritten');assert.deepEqual(await readFile(damagedPath),Buffer.from(damagedBytes));await language('zh-CN');
  const recoveredPath=join(temp,'recovered.rcproj');await click('保存工程');await picker(recoveredPath,'Save File');await visibleText('已保存工程文件');
  const recoveredManifest=await manifest(recoveredPath);assert.notEqual(recoveredManifest.project.id,damagedManifest.project.id);assert.equal(recoveredManifest.entrypoints.app,null);
  assert.ok(recoveredManifest.files.some(f=>f.path.endsWith('/report.json')));
  await rename('recovery-edited');await click('保存工程');await visibleText('已保存工程文件');assert.equal((await manifest(recoveredPath)).project.name,'recovery-edited');assert.deepEqual(await readFile(damagedPath),Buffer.from(damagedBytes));
  console.log('Desktop: damaged archive recovery, protected source rejection and separate save passed.');
  // Load the shared fixture through Vite's TS transform. No test-only runtime
  // command is added to the packaged application.
  const compiler=await createViteServer({server:{middlewareMode:true},appType:'custom'});
  const runtimeProject=join(temp,'runtime-source.rcproj');
  try {
    const {resourceProject}=await compiler.ssrLoadModule('/tests/fixtures/resources.ts');
    const {saveProject}=await compiler.ssrLoadModule('/src/core/project/archive.ts');
    await writeFile(runtimeProject,await saveProject(resourceProject()));
  } finally { await compiler.close(); }
  await click('打开工程');await picker(runtimeProject,'Open File');await visibleText('切换工程');await click('打开新工程');await visibleText('portable');
  const sourceBefore=await readFile(runtimeProject),exportParent=join(temp,'runtime-exports');await mkdir(exportParent);
  await writeFile(join(exportParent,'existing.txt'),'preserve existing');
  await menu('校验与导出');await click('导出到新目录');await visibleText('运行包导出计划');await click('选择父目录并导出');
  const folderDialog=await wait(()=>xdotool('search','--onlyvisible','--name','^Select Folder$').split('\n')[0],'export folder picker');
  xdotool('windowactivate','--sync',folderDialog);xdotool('key','--clearmodifiers','Escape');
  await wait(()=>script(`return !document.querySelector('.file-transfer');`),'cancel directory export');
  assert.deepEqual(await readdir(exportParent),['existing.txt']);
  await click('导出到新目录');await visibleText('运行包导出计划');await click('选择父目录并导出');await picker(exportParent,'Select Folder');await visibleText('运行目录已导出');
  const names=(await readdir(exportParent)).filter(n=>n!=='existing.txt');assert.equal(names.length,1);const runtimeDir=join(exportParent,names[0]);
  const receipt=JSON.parse(await readFile(join(runtimeDir,'ROCOS-EXPORT.json'),'utf8'));assert.equal(receipt.status,'complete');
  for(const file of receipt.files){const bytes=await readFile(join(runtimeDir,file.path));assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  assert.equal(await readFile(join(exportParent,'existing.txt'),'utf8'),'preserve existing');assert.deepEqual(await readFile(runtimeProject),sourceBefore);
  assert.match(await readFile(join(runtimeDir,'models/robot.urdf'),'utf8'),/filename="meshes\/part.dae"/);
  await language('en-US');await visibleText('Runtime directory exported');await visibleText('files written and verified');
  await language('zh-CN');await visibleText('运行目录已导出');await click('知道了');await click('检查并导出配置');await visibleText('运行包导出计划');await click('下载运行包');
  const runtimeZip=join(temp,'runtime.zip');await picker(runtimeZip,'Save File');await wait(()=>{accessSync(runtimeZip);return true;},'runtime zip');
  const runtimeEntries=unzipSync(await readFile(runtimeZip));assert.deepEqual(Object.keys(runtimeEntries).sort(),receipt.files.map(f=>f.path).sort());
  for(const [path,bytes] of Object.entries(runtimeEntries))assert.deepEqual(await readFile(join(runtimeDir,path)),Buffer.from(bytes));
  await rename('after-directory-export');await click('保存工程');await visibleText('已保存工程文件');assert.equal((await manifest(runtimeProject)).project.name,'after-directory-export');
  console.log('Desktop: cancelled directory picker, verified new directory, unchanged existing files, ZIP byte parity and retained project save target passed.');
  for(const kind of ['igh','ecm']){
    await menu('工程总览');await click('打开示例');await click(kind==='igh'?'打开 IgH 示例':'打开 EC-Master 示例');
    await visibleText('切换工程');await click('打开新工程');await visibleText('教学示例');
    await menu('硬件与绑定');
    await wait(()=>script(`const label=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('已人工核对换算、零点与限位'));const input=label?.querySelector('input');if(!input)return false;if(!input.checked)input.click();return true;`),'review teaching mechanics');
    const exampleArchive=join(temp,kind+'-example.rcproj');await click('保存工程');await picker(exampleArchive,'Save File');await visibleText('已保存工程文件');
    const example=await manifest(exampleArchive);assert.equal(example.entrypoints.master.kind,kind);
    const sourceEntries=unzipSync(await readFile(exampleArchive));
    await menu('校验与导出');await click('检查并导出配置');await visibleText('运行包导出计划');await click('下载运行包');
    const exampleRuntime=join(temp,kind+'-example-runtime.zip');await picker(exampleRuntime,'Save File');
    await wait(()=>{accessSync(exampleRuntime);return true;},'teaching runtime');const files=unzipSync(await readFile(exampleRuntime));
    assert.ok(files['master/'+kind+'.yaml']);assert.ok(files['app/hardware_config.yaml']);assert.ok(files['models/robot.urdf']);
    assert.equal(Object.keys(files).some(path=>path.startsWith('project-data/')),false);
    if(kind==='ecm')assert.deepEqual(files['master/eni.xml'],sourceEntries['master/eni.xml']);
    await writeFile(join(artifacts,kind+'-example.rcproj'),await readFile(exampleArchive));
    await writeFile(join(artifacts,kind+'-example-runtime.zip'),await readFile(exampleRuntime));
  }
  console.log('Desktop: both teaching examples saved and runtime-exported with ENI byte parity.');
  const multiCompiler=await createViteServer({server:{middlewareMode:true},appType:'custom'}),multiPath=join(temp,'multiple-devices.rcproj'),displayPath=join(temp,'display.rcproj');
  try {
    const {multiaxisProject}=await multiCompiler.ssrLoadModule('/tests/fixtures/multiaxis.ts');
    const {saveProject}=await multiCompiler.ssrLoadModule('/src/core/project/archive.ts');
    await writeFile(multiPath,await saveProject(multiaxisProject()));
    const {previewProject}=await multiCompiler.ssrLoadModule('/tests/fixtures/preview.ts');
    await writeFile(displayPath,await saveProject(previewProject()));
  } finally {await multiCompiler.close();}
  await click('打开工程');await picker(multiPath,'Open File');await visibleText('切换工程');await click('打开新工程');await menu('硬件与绑定');
  const multiBefore=await readFile(multiPath);
  await wait(()=>script(`const e=document.querySelector('input[type=radio][aria-label="选择设备 4（driver）"]');if(!e||!e.checked)return false;e.focus();return true;`),'native device radio focus');
  xdotool('key','--clearmodifiers','Down');
  await wait(()=>script(`return document.querySelector('input[type=radio][aria-label="选择设备 0（driver）"]')?.checked&&document.querySelector('input[id$="transform.ratio"]')?.value==='100';`),'native second device selected');
  assert.deepEqual(await readFile(multiPath),multiBefore);
  await script(`const e=document.querySelector('input[id$="transform.ratio"]');e.focus();e.select();`);
  xdotool('key','--clearmodifiers','ctrl+a');xdotool('type','--clearmodifiers','7');xdotool('key','--clearmodifiers','Tab');
  await click('保存工程');await visibleText('已保存工程文件');
  const multiManifest=await manifest(multiPath),multiEntries=unzipSync(await readFile(multiPath));
  const hardwarePath=multiManifest.files.find(f=>f.id===multiManifest.entrypoints.hardware).path;
  const driveValues=parseYaml(new TextDecoder().decode(multiEntries[hardwarePath])).hardware.map(d=>[d.id,d.transform.ratio]);
  assert.deepEqual(driveValues,[[4,104],[0,7],[2,102]]);
  await writeFile(join(artifacts,'multiple-devices-edited.rcproj'),await readFile(multiPath));
  console.log('Desktop: keyboard device selection and isolated second-drive editing passed.');
  const displayBefore=unzipSync(await readFile(displayPath));
  await click('打开工程');await picker(displayPath,'Open File');await visibleText('切换工程');await click('打开新工程');await menu('机器人模型');
  await visibleText('collision_only');await click('适应模型');
  await script(`const e=[...document.querySelectorAll('.model-tree .ant-tree-title')].find(e=>e.textContent==='joint_1 [revolute]');e.click();document.querySelector('[role=slider]').focus();`);
  xdotool('key','--clearmodifiers','End');await wait(()=>script(`return document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')==='1';`),'native display pose');
  await script(`document.querySelector('input[role=combobox][aria-label="模型显示"]').focus();`);xdotool('key','--clearmodifiers','Down');
  await wait(()=>script(`return !!document.querySelector('.ant-select-item-option[title="碰撞（Collision）"]')?.offsetParent;`),'native collision popup');
  xdotool('key','--clearmodifiers','Down','Return');
  await wait(()=>script(`return document.querySelector('.robot-preview')?.dataset.geometry==='collision';`),'native collision selection');
  await click('正视');await menu('APP 配置');await menu('机器人模型');
  await wait(()=>script(`const p=document.querySelector('.robot-preview');return p?.dataset.selected==='joint:joint_1'&&p.dataset.geometry==='collision'&&document.querySelector('[role=slider]')?.getAttribute('aria-valuenow')==='1';`),'native navigation retains preview state');
  await click('展开视图');
  await wait(()=>script(`const d=document.querySelector('.model-viewport-expanded');return d?.getAttribute('aria-modal')==='true'&&!!d.querySelector('canvas')&&document.querySelectorAll('canvas').length===1;`),'native expanded canvas');
  for(let i=0;i<14;i++){
    await script(`window.nativeTabFrom=document.activeElement;`);xdotool('key','--clearmodifiers','Tab');
    await wait(()=>script(`return document.activeElement!==window.nativeTabFrom&&!!document.activeElement?.closest('[role=dialog]');`),'native Tab advances inside model '+i);
  }
  await pointerClick('.model-viewport-expanded .preview-display-tools .ant-select');
  await wait(()=>script(`const e=document.querySelector('.model-viewport-expanded .ant-select-item-option[title="外观（Visual）"]');return !!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';`),'native expanded display popup');
  await pointerClick('.model-viewport-expanded .ant-select-item-option[title="外观（Visual）"]');
  await wait(()=>script(`return document.querySelector('.robot-preview')?.dataset.geometry==='visual';`),'native expanded visual selection');
  xdotool('key','--clearmodifiers','Escape');
  await wait(()=>script(`return !document.querySelector('.model-viewport-expanded')&&document.activeElement?.textContent==='展开视图';`),'native Escape and restored focus');
  await click('展开视图');await click('退出展开视图');
  await click('保存工程');await visibleText('已保存工程文件');
  const displayAfter=unzipSync(await readFile(displayPath));assert.deepEqual(Object.keys(displayAfter).sort(),Object.keys(displayBefore).sort());
  for(const [path,bytes] of Object.entries(displayBefore))if(path!=='rocos-project.json')assert.deepEqual(displayAfter[path],bytes);
  const beforeManifest=JSON.parse(new TextDecoder().decode(displayBefore['rocos-project.json'])),afterManifest=await manifest(displayPath);
  assert.equal(afterManifest.project.revision,beforeManifest.project.revision);assert.deepEqual(afterManifest.entrypoints,beforeManifest.entrypoints);
  console.log('Desktop: collision display, navigation state, modal focus/Escape and unchanged project payloads passed.');
  await writeFile(join(artifacts,'report.json'),JSON.stringify({
    status:'passed',applicationVersion:expectedVersion,platform:process.platform,architecture:process.arch,node:process.version,
    binary:{path:binary,sha256:createHash('sha256').update(await readFile(binary)).digest('hex')},
    scope:'Actual Linux WebKit application, native GTK dialogs and temporary files in an isolated display.',
    checks:['displayed and archived application version','initial save and verified backup','bilingual overwrite-backup notification','external conflict with bilingual reason and difference view','save as','native directory import','same-ID copy and new-ID fork','browser and desktop archive roundtrip','background URDF analysis and WebGL viewport','collapsed model tree reveal and retained/clamped preview pose','bilingual unsaved-close confirmation and cancellation','damaged archive recovery and protected source','directory picker cancellation','bilingual directory-export success dialog','directory receipt and file hashes','ZIP and directory byte parity','retained project save target','both teaching examples archived and runtime-exported','keyboard device selection and isolated second-drive editing','geometry display and model page state','expanded canvas, focus cycle and Escape'],
    notExecuted:['Windows installation','independent offline computer','power loss or full disk','controller SDK or physical devices'],
  },null,2)+'\n');
} catch(e) {
  console.error(e);
  await writeFile(join(artifacts,'failure.txt'),String(e.stack||e));
  try{if(session)await writeFile(join(artifacts,'failure-ui.txt'),await text());}catch{}
  try{if(session)await writeFile(join(artifacts,'failure-dom.json'),JSON.stringify(await script(`return {active:document.activeElement?.outerHTML,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({open:e.open,html:e.innerHTML})),popups:[...document.querySelectorAll('.ant-select-dropdown')].map(e=>({html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display,offset:!!e.offsetParent}))};`),null,2));}catch{}

  throw e;
} finally {
  await browser?.close().catch(()=>{});
  if(session)await request('DELETE',`/session/${session}`).catch(()=>{});
  // Desktop portals may mount FUSE directories in this test's private runtime.
  // Unmount only those known paths before terminating their D-Bus session.
  for(const name of ['doc','gvfs'])try{execFileSync('fusermount3',['-u',join(env.XDG_RUNTIME_DIR,name)],{stdio:'ignore',timeout:5000});}catch{}
  for(const child of children.reverse()){
    // Stop the isolated process group, including WebKit and D-Bus descendants.
    if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
    if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),pause(2000)]);
    if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}
  }
  await writeFile(join(artifacts,'native.log'),log.join(''));
  await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(e=>console.warn(`Test cleanup retained ${temp}: ${e.message}`));
}
