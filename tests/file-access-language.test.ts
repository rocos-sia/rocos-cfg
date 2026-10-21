import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import english from '../src/i18n/en.json';
import { errorText, diagnosticText, setLocale } from '../src/i18n';
import { DesktopFileAccess, type FileHandle, type Invoke } from '../src/adapters/file-access';
import { m } from '../src/core/project/messages';
import { utf8 } from '../src/core/project/types';
const handle:FileHandle={token:'selected',name:'工程总览-{detail}.rcproj',displayPath:'/selected/工程总览-{detail}.rcproj',size:3,sha256:'old'};
afterEach(()=>setLocale('zh-CN'));
it('retains native conflict metadata and its baseline while allowing display language changes',async()=>{
  const payload={code:'conflict',currentHash:'external',...m('文件已被外部修改或删除；请选择另存为，或先查看磁盘版本。')};
  const invoke=vi.fn(async(name:string)=>{if(name==='begin_write')throw structuredClone(payload);});
  const original=structuredClone(handle),error=await new DesktopFileAccess(invoke as Invoke).write(utf8.encode('new'),'project',{target:handle}).catch(e=>e);
  expect(error).toMatchObject(payload);setLocale('en-US');
  expect(errorText(error)).toBe('The file was changed or deleted externally; choose Save as or inspect the disk version first.');
  expect(handle).toEqual(original);expect(invoke.mock.calls.map(([name])=>name)).toEqual(['begin_write']);
  setLocale('zh-CN');expect(errorText(error)).toBe(payload.message);
});
it('keeps native OS details and braces literal, and ignores malformed or inconsistent optional templates',async()=>{
  const detail='工程总览/{detail}.rcproj: native OS reason',valid=m('文件访问权限被拒绝：{detail}',{detail});
  for(const text of [valid.text,{key:valid.text.key,values:{detail:{invalid:true}}},{...valid.text,values:{detail:'wrong'}}]){
    const access=new DesktopFileAccess((async()=>{throw {code:'io',message:valid.message,text};}) as Invoke);
    const error=await access.read({...handle,sha256:'hash',size:3}).catch(e=>e);setLocale('en-US');
    expect(errorText(error)).toBe(text===valid.text?'File access permission denied: '+detail:valid.message);
  }
  const raw=new DesktopFileAccess((async()=>{throw {code:'io',message:'external 工程总览-{detail}'};}) as Invoke);
  expect(errorText(await raw.read(handle).catch(e=>e))).toBe('external 工程总览-{detail}');
});
it('returns committed writes with translatable warnings and never treats them as failed saves',async()=>{
  const warning=m('文件已替换，但目录同步失败：{detail}',{detail:'OS {detail} 中文'}),calls:string[]=[];
  const done={...handle,sha256:'new'};
  const invoke=async(name:string)=>{calls.push(name);return name==='begin_write'?'upload':name==='finish_write'?{handle:done,warning:warning.message,warningText:warning.text}:undefined;};
  const result=await new DesktopFileAccess(invoke as Invoke).write(utf8.encode('new'),'project',{target:handle});
  expect(result?.kind).toBe('written');if(result?.kind!=='written')return;
  expect(result.handle).toEqual(done);expect(calls).toEqual(['begin_write','write_chunk','finish_write']);
  setLocale('en-US');expect(diagnosticText({message:result.warning!,text:result.warningText})).toBe('File was replaced, but directory synchronization failed: OS {detail} 中文');
});
it('localizes nested directory cleanup failures without hiding the original OS detail or committing files',async()=>{
  const calls:string[]=[];
  const invoke=async(name:string)=>{calls.push(name);if(name==='choose_directory_export')return 'transfer';if(name==='write_directory_chunk')throw new Error('write failed');if(name==='cancel_directory_export')throw {code:'io',...m('文件访问权限被拒绝：{detail}',{detail:'目录/{detail}'})};};
  const error=await new DesktopFileAccess(invoke as Invoke).writeDirectory([{path:'app/config.yaml',bytes:utf8.encode('x')}],'runtime').catch(e=>e);
  setLocale('en-US');expect(error.code).toBe('cleanup');expect(errorText(error)).toBe('Directory export is incomplete and staging cleanup failed; check ROCOS-EXPORT.json in the selected parent directory: File access permission denied: 目录/{detail}');
  expect(calls).not.toContain('finish_directory_export');
});
it('has English entries for native application messages without translating OS-generated strings',()=>{
  // Native production sources use Chinese literals only for application messages.
  // Tests contain arbitrary user strings and are excluded from this inventory.
  for(const path of ['files.rs','runtime_directory.rs','desktop.rs']){
    const source=readFileSync(new URL('../src-tauri/src/'+path,import.meta.url),'utf8').split('#[cfg(test)]')[0];
    for(const match of source.matchAll(/"([^"\n]*[\u4e00-\u9fff][^"\n]*)"/g))expect(Object.hasOwn(english,match[1]),path+': '+match[1]).toBe(true);
  }
});
