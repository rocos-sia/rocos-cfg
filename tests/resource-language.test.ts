import { afterEach, expect, it, vi } from 'vitest';
vi.mock('idb-keyval',()=>({get:vi.fn(),getMany:vi.fn().mockResolvedValue([]),keys:vi.fn().mockResolvedValue([]),delMany:vi.fn().mockResolvedValue(undefined),setMany:vi.fn().mockResolvedValue(undefined)}));
import { setLocale, errorText, diagnosticText } from '../src/i18n';
import { MessageError, errorMessage, messageFields } from '../src/core/project/messages';
import { mapReference, moveResource, setPackagePath } from '../src/core/project/resources';
import { collectReferences } from '../src/core/project/references';
import { nativeModules } from '../src/core/modules/builtin';
import { assertEditableFile } from '../src/core/modules/project';
import { ModuleRegistry } from '../src/core/modules/registry';
import { attachProfile } from '../src/core/project/profiles';
import { planRuntime } from '../src/core/export';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { resourceProject } from './fixtures/resources';
import { discardRecovery, useProject } from '../src/store';
afterEach(()=>setLocale('zh-CN'));
function failure(fn:()=>unknown){try{fn();}catch(e){expect(e).toBeInstanceOf(MessageError);return e as MessageError;}throw new Error('Expected failure');}

it('localizes resource mapping and relocation errors without changing files, references or targets',()=>{
  const p=resourceProject(),before=structuredClone(p),ref=collectReferences(p).find(r=>r.field==='robot.urdf')!;
  for(const [run,en] of [
    [()=>mapReference(p,ref,{external:true}),'Core master and APP configuration must be included in the project and cannot be marked as external resources'],
    [()=>mapReference(p,ref,{fileId:p.entrypoints.hardware!}),'This reference requires a urdf file'],
    [()=>moveResource(p,p.entrypoints.urdf!,'project-data/工程总览-{v0}.urdf'),'Cannot use a reserved project path'],
    [()=>setPackagePath(p,'../工程总览','models'),'Package names may contain only letters, digits, underscores and hyphens'],
  ] as const){
    setLocale('en-US');const error=failure(run);expect(error.message).toMatch(/[\u4e00-\u9fff]/);
    expect(errorText(error)).toBe(en);setLocale('zh-CN');expect(errorText(error)).toBe(error.message);expect(p).toEqual(before);
  }
});
it('preserves resource paths as literal data in serialized module-export errors',()=>{
  const p=resourceProject(),file={...p.files[0],path:'目录/工程总览-{v0}.bin'};
  const error=failure(()=>nativeModules.find(m=>m.id==='resource')!.export(null,{project:p,file,path:file.path,rewrites:[{field:'raw',value:'new'}]}));
  const serialized=JSON.parse(JSON.stringify(messageFields(errorMessage(error))));setLocale('en-US');
  expect(diagnosticText(serialized)).toBe('Rewriting resource references in 目录/工程总览-{v0}.bin is not supported yet');
});
it('preserves target-profile failure metadata instead of freezing it into a raw error',()=>{
  const p=resourceProject();p.targets.master.profile!.id='工程总览-{v0}';const error=failure(()=>attachProfile(p,'master'));
  setLocale('en-US');expect(errorText(error)).toContain('工程总览-{v0}');expect(errorText(error)).not.toBe(error.message);
  expect(p.targets.master.profile!.id).toBe('工程总览-{v0}');
});
it('localizes module parse/registration and runtime rejection errors while preserving the original project',()=>{
  const p=resourceProject(),before=structuredClone(p);
  const parse=failure(()=>nativeModules.find(m=>m.id==='model.dae')!.parse({...p.files[0],bytes:utf8.encode('<wrong/>')}));
  const duplicate=failure(()=>new ModuleRegistry([nativeModules[0],nativeModules[0]]));
  const readonly=failure(()=>assertEditableFile(p,{...p.files[0],role:'eni'}));
  p.editor.confirmations={};const blocked=structuredClone(p),runtime=failure(()=>planRuntime(p));
  setLocale('en-US');expect(errorText(parse)).toBe('The DAE root element must be COLLADA');
  expect(errorText(duplicate)).toBe('Duplicate module ID: igh');expect(errorText(readonly)).toBe('ENI is always read-only');
  expect(errorText(runtime)).toMatch(/^Runtime configuration still has \d+ errors/);expect(p).toEqual(blocked);expect(p.files).toEqual(before.files);
});
it('retains source drafts, file bytes and revision after a translated baseline conflict',async()=>{
  const p=resourceProject(),id=p.entrypoints.master.fileId!;useProject.getState().load(p);
  await useProject.getState().buffer(id,textOf(fileById(p,id)!)+'\n# 草稿-{v0}\n');
  useProject.getState().change(next=>{fileById(next,id)!.bytes=utf8.encode(textOf(fileById(next,id)!)+'\n# 外部改动\n');});
  const before=structuredClone(useProject.getState().project);setLocale('en-US');
  const error=await useProject.getState().apply(id).catch(e=>e);
  expect(error).toBeInstanceOf(MessageError);expect(errorText(error)).toContain('conflicts with the draft baseline');
  setLocale('zh-CN');expect(errorText(error)).toContain('源码草稿基线冲突');expect(useProject.getState().project).toEqual(before);
});
it('keeps ENI read-only and protects the active recovery draft in both languages',async()=>{
  const p=resourceProject();p.files[0].role='eni';useProject.getState().load(p);const before=structuredClone(useProject.getState().project);
  const error=await useProject.getState().buffer(p.files[0].id,'forbidden').catch(e=>e);
  const active=await discardRecovery(useProject.getState().recoveryKey!).catch(e=>e);
  setLocale('en-US');expect(errorText(error)).toBe('The file is read-only; a source draft cannot be written');
  expect(errorText(active)).toBe('The current workspace recovery draft cannot be deleted');expect(useProject.getState().project).toEqual(before);
});
