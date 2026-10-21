import { afterEach, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { diagnosticText, errorText, setLocale } from '../src/i18n';
import { inspectProjectArchive, openProject, saveProject } from '../src/core/project/archive';
import { inspectProjectRecovery } from '../src/core/project/recover';
import { inspectZip, packZip, unpackZip } from '../src/core/project/zip';
import { inspectImport, applyImport } from '../src/core/project/import';
import { makeFile } from '../src/core/project/create';
import { digest, fileById, textOf, utf8 } from '../src/core/project/types';
import { compareBus } from '../src/core/bus/compare';
import { MigrationRegistry } from '../src/core/project/migrations';
import { MessageError, m } from '../src/core/project/messages';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { resourceProject } from './fixtures/resources';

afterEach(()=>setLocale('zh-CN'));
it('keeps nested migration errors translatable while preserving the input and opaque external details',async()=>{
  // A synthetic registry tests transport; it does not declare a released v2 format.
  const data={manifest:{format:'test-only',formatVersion:1,projectSchemaVersion:1},files:new Map([['工程总览',utf8.encode('untouched')]])},before=structuredClone(data);
  for(const failure of [new MessageError(m('文件 SHA-256 不匹配：{v0}',{v0:'工程总览-{v0}'})),new Error('external 工程总览-{v0}')]){
    const registry=new MigrationRegistry(2,[1,2].map(version=>({version,validate:()=>{}})),[{id:'test-step',from:1,to:2,description:'test only',transform:d=>{d.files.clear();throw failure;}}]);
    const error=await registry.prepare(data).catch(e=>e);setLocale('en-US');
    expect(errorText(error)).toBe('Project migration test-step (1 → 2) failed: '+(failure instanceof MessageError?'File SHA-256 mismatch: 工程总览-{v0}':'external 工程总览-{v0}'));
    expect(data).toEqual(before);setLocale('zh-CN');expect(errorText(error)).toContain('工程迁移 test-step');
  }
});
it('transports readonly reasons without changing unsupported archives or user names',async()=>{
  const p=resourceProject();p.name='工程总览-{v0}';
  const entries=unpackZip(await saveProject(p)),manifest=JSON.parse(new TextDecoder().decode(entries.get('rocos-project.json')));
  manifest.formatVersion=999;entries.set('rocos-project.json',utf8.encode(JSON.stringify(manifest)));
  const bytes=packZip(entries),result=structuredClone(await inspectProjectArchive(bytes));
  expect(result.mode).toBe('readonly');if(result.mode!=='readonly')return;
  const before=structuredClone(result),error=await openProject(bytes).catch(e=>e);
  setLocale('en-US');
  expect(diagnosticText({message:result.reason,text:result.reasonText})).toContain('Unsupported project format version');
  expect(errorText(error)).toContain('Unsupported project format version');
  expect(result.summary.name).toBe(p.name);expect(result).toEqual(before);expect(result.original).toEqual(bytes);
});
it('preserves names and source bytes in damaged-file errors, recovery records and archived notices',async()=>{
  const p=resourceProject(),file=makeFile('中文目录/工程总览-{v0}.txt','attachment','original');p.files.push(file);
  const entries=unpackZip(await saveProject(p));entries.set(file.path,utf8.encode('modified'));
  const bytes=packZip(entries),before=new Uint8Array(bytes),error=await openProject(bytes).catch(e=>e);
  const result=structuredClone(await inspectProjectRecovery(bytes));
  const restored=await openProject(await saveProject(result.project)),reportFile=restored.files.find(f=>f.path.endsWith('/report.json'))!;
  const report=JSON.parse(textOf(reportFile)),reportHash=await digest(reportFile.bytes);
  setLocale('en-US');
  expect(errorText(error)).toBe('File SHA-256 mismatch: '+file.path);
  expect(diagnosticText(result.records.find(r=>r.path===file.path)!)).toBe('SHA-256 does not match the manifest');
  expect(result.noteMessages.map(diagnosticText)).toContain('All device, mechanical parameter and binding confirmations were reset; validate the recovered project again.');
  expect(report.noteMessages.map(diagnosticText)).toEqual(result.noteMessages.map(diagnosticText));
  expect(diagnosticText(restored.editor.notices!.at(-1)!)).toContain('This project was recovered from a damaged archive');
  expect(await digest(reportFile.bytes)).toBe(reportHash);expect(bytes).toEqual(before);
  setLocale('zh-CN');expect(diagnosticText(result.records.find(r=>r.path===file.path)!)).toBe('SHA-256 与 manifest 不符');
});
it('retains localized CRC and truncated-directory evidence and still rejects unsafe paths',async()=>{
  const p=resourceProject(),bytes=zipSync(Object.fromEntries(unpackZip(await saveProject(p))),{level:0});
  const entry=inspectZip(bytes).find(f=>f.path==='master/igh.yaml')!,corrupt=new Uint8Array(bytes);corrupt[entry.body]^=1;
  const recovery=await inspectProjectRecovery(corrupt);
  const end=new DataView(bytes.buffer).getUint32(bytes.length-6,true),truncated=await inspectProjectRecovery(bytes.slice(0,end+12));
  const unsafe=zipSync({'../工程总览-{v0}':utf8.encode('not a project')}),error=await inspectProjectRecovery(unsafe).catch(e=>e);
  setLocale('en-US');
  expect(diagnosticText(recovery.records.find(r=>r.path===entry.path)!)).toBe('ZIP CRC mismatch');
  expect(truncated.noteMessages.map(diagnosticText).some(m=>m.startsWith('The ZIP central directory or end record is truncated'))).toBe(true);
  expect(errorText(error)).toBe('Invalid project path: ../工程总览-{v0}');
});
it('renders import failures and bus changes without interpreting names as messages',()=>{
  const p=resourceProject(),source=textOf(fileById(p,p.entrypoints.master.fileId)!);
  const plan=inspectImport(p,new Map([['中文目录/one.yaml',utf8.encode(source)],['中文目录/two.yaml',utf8.encode(source)]]));
  let error:unknown;try{applyImport(p,plan);}catch(e){error=e;}
  const next=structuredClone(p);editProjectYaml(next,next.entrypoints.master.fileId!,doc=>doc.setIn(['slaves',0,'name'],'工程总览-{name}'));
  const changes=structuredClone(compareBus(buildBusCatalog(p),buildBusCatalog(next))),before=structuredClone(changes);
  setLocale('en-US');expect(errorText(error)).toBe('Select the active master configuration; other candidates will be retained');
  expect(diagnosticText({message:changes[0].object,text:changes[0].objectText})).toBe('Slave 0');
  expect(diagnosticText({message:changes[0].after,text:changes[0].afterText})).toBe('Name=工程总览-{name}; address=—; vendor=—; product=—');
  expect(changes).toEqual(before);
});
