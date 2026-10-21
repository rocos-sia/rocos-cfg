import { describe, expect, it, vi } from 'vitest';
import { DesktopFileAccess, FileAccessError, type FileAccess, type FileHandle, type Invoke, type WriteOptions, type WriteResult } from '../src/adapters/file-access';
import { ProjectSession } from '../src/adapters/project-session';
import { createProject, makeFile } from '../src/core/project/create';
import { digest, utf8 } from '../src/core/project/types';
import { openProject, saveProject } from '../src/core/project/archive';
const handle=(token:string,sha256:string|null=null):FileHandle=>({token,name:token+'.rcproj',displayPath:'/selected/'+token+'.rcproj',size:0,sha256});

describe('desktop binary file adapter',()=>{
  it('prevents closing during standalone native exports and releases the busy state on cancellation',async()=>{
    let choose!:(h:null)=>void;
    const invoke=vi.fn(async(name:string)=>name==='choose_target'?new Promise<null>(r=>choose=r):undefined);
    const access=new DesktopFileAccess(invoke as Invoke);
    const writing=access.write(utf8.encode('runtime'),'config.zip');
    expect(access.busy).toBe(true);
    await expect(access.close()).rejects.toMatchObject({code:'busy'});
    expect(invoke).not.toHaveBeenCalledWith('close_confirmed',undefined,undefined);
    choose(null);expect(await writing).toBeUndefined();expect(access.busy).toBe(false);
    await access.close();expect(invoke).toHaveBeenCalledWith('close_confirmed',undefined,undefined);
  });
  it('streams archive bytes, verifies the native hash and releases a changed read',async()=>{
    const bytes=utf8.encode('archive bytes'),h={...handle('opened',await digest(bytes)),size:bytes.length};
    const invoke=vi.fn(async(cmd:string)=>cmd==='choose_project'?h:cmd==='read_chunk'?new Uint8Array(bytes).buffer:undefined);
    const access=new DesktopFileAccess(invoke as Invoke);expect((await access.open())?.bytes).toEqual(bytes);
    h.sha256='0'.repeat(64);await expect(access.open()).rejects.toMatchObject({code:'changed'});
    expect(invoke).toHaveBeenCalledWith('release_file',{token:'opened'},undefined);
  });
  it('writes bounded binary chunks and returns the committed target without claiming cancellation after commit',async()=>{
    const bytes=new Uint8Array(4*1024**2+3);bytes.fill(7);const h=handle('new'),done={...h,sha256:await digest(bytes),size:bytes.length};
    const calls:{name:string;args:any;options:any}[]=[];
    const invoke=async(name:string,args:any,options:any)=>{calls.push({name,args,options});return name==='choose_target'?h:name==='begin_write'?'transfer':name==='finish_write'?{handle:done,backupPath:'/selected/backup.rcproj'}:undefined;};
    const result=await new DesktopFileAccess(invoke as Invoke).write(bytes,'工程.rcproj');
    expect(result).toEqual({kind:'written',handle:done,backupPath:'/selected/backup.rcproj'});
    const chunks=calls.filter(c=>c.name==='write_chunk');expect(chunks.map(c=>c.args.length)).toEqual([4*1024**2,3]);expect(chunks[1].options.headers['x-offset']).toBe(String(4*1024**2));
    expect(calls.some(c=>c.name==='release_file')).toBe(false);
  });
  it('aborts incomplete transfers and never commits after cancellation or a failed chunk',async()=>{
    const c=new AbortController(),h=handle('existing');const calls:string[]=[];
    const invoke=async(name:string)=>{calls.push(name);if(name==='begin_write')return 'transfer';if(name==='write_chunk')c.abort();};
    await expect(new DesktopFileAccess(invoke as Invoke).write(utf8.encode('data'),'p.rcproj',{target:h,signal:c.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(calls).toContain('cancel_write');expect(calls).not.toContain('finish_write');expect(calls).not.toContain('release_file');
  });
  it('reports a structured conflict and keeps the old file handle for review',async()=>{
    const h=handle('existing','old');const invoke=vi.fn(async(name:string)=>{if(name==='begin_write')throw {code:'conflict',message:'changed',currentHash:'new'};});
    await expect(new DesktopFileAccess(invoke as Invoke).write(utf8.encode('data'),'p',{target:h})).rejects.toEqual(new FileAccessError('conflict','changed','new'));
    expect(invoke).not.toHaveBeenCalledWith('release_file',expect.anything(),expect.anything());
  });
  it('passes protected recovery sources to the native picker before any write starts',async()=>{
    const invoke=vi.fn(async(name:string)=>{if(name==='choose_target')throw {code:'same-target',message:'protected original'};});
    await expect(new DesktopFileAccess(invoke as Invoke).write(utf8.encode('recovered'),'new.rcproj',{exclude:handle('current'),protectedTargets:[handle('damaged')]})).rejects.toMatchObject({code:'same-target'});
    expect(invoke).toHaveBeenCalledWith('choose_target',{suggestedName:'new.rcproj',excludeToken:'current',protectedTokens:['damaged']},undefined);
    expect(invoke.mock.calls.some(([name])=>name==='begin_write')).toBe(false);
  });
  it('preserves native directory relative paths and releases all import capabilities',async()=>{
    const bytes=utf8.encode('mesh'),h={...handle('mesh',await digest(bytes)),name:'part.stl',relativePath:'meshes/part.stl',size:4};
    const invoke=vi.fn(async(name:string)=>name==='choose_import'?[h]:name==='read_chunk'?bytes.buffer:undefined);
    const files=await new DesktopFileAccess(invoke as Invoke).import(true);expect(files?.[0].webkitRelativePath).toBe('selected/meshes/part.stl');expect(await files?.[0].text()).toBe('mesh');
    expect(invoke).toHaveBeenCalledWith('release_file',{token:'mesh'},undefined);
  });
});
describe('project save targets and snapshots',()=>{
  const fake=()=>{
    const calls:{bytes:Uint8Array;name:string;options?:WriteOptions}[]=[];
    const access:FileAccess={kind:'desktop',open:vi.fn(),read:vi.fn(),import:vi.fn(),refresh:vi.fn(),release:vi.fn(async()=>{}),write:async(bytes,name,options)=>{calls.push({bytes,name,options});return {kind:'written',handle:options?.target||handle('chosen-'+calls.length)};}};
    return {calls,access,session:new ProjectSession(access)};
  };
  it('save-as adopts a new target, copies keep the target and archive data excludes host paths',async()=>{
    const {session,access,calls}=fake(),p=createProject('robot','igh');await session.adopt(p.id,handle('original'));
    await session.save(p,'save','development');expect(calls[0].options?.target?.token).toBe('original');
    await session.save(p,'copy','development');expect(session.handle?.token).toBe('original');expect(calls[1].options?.exclude?.token).toBe('original');
    expect(access.release).toHaveBeenCalledWith(handle('chosen-2'));
    await session.save(p,'saveAs','development');expect(session.handle?.token).toBe('chosen-3');
    expect(access.release).toHaveBeenCalledWith(handle('original'));
    const restored=await openProject(calls[2].bytes);expect(restored.id).toBe(p.id);expect(JSON.stringify(restored)).not.toContain('/selected/');
  });
  it('preserves a target when save-as is cancelled and does not attach a late save to another workspace',async()=>{
    const {session,access}=fake(),p=createProject('robot','igh');await session.adopt(p.id,handle('original'));
    access.write=async()=>undefined;expect(await session.save(p,'saveAs','development')).toBeUndefined();expect(session.handle?.token).toBe('original');
    let resolve!:(value:WriteResult)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
    access.write=async()=>{started();return new Promise(r=>resolve=r);};const save=session.save(p,'saveAs','development');await ready;
    await session.adopt('another-workspace',handle('another'));resolve({kind:'written',handle:handle('late')});
    expect((await save)?.current).toBe(false);expect(session.handle?.token).toBe('another');expect(access.release).toHaveBeenCalledWith(handle('late'));
  });
  it('forks independently while preserving source bytes, draft references and unknown optional modules',async()=>{
    const {session,access,calls}=fake();
    const source=createProject('来源工程','ecm'),eni=makeFile('master/eni.xml','eni','<!-- retain original -->\r\n<EtherCATConfig/>');
    const vendor=makeFile('extra/vendor.bin','vendor.future','opaque vendor data');vendor.owner='vendor.future';
    source.files.push(eni,vendor);source.entrypoints.master.eniFileId=eni.id;
    source.modules=[{id:'vendor.future',version:5,required:false,fileIds:[vendor.id],custom:{sequence:[2,1]}}];
    source.revision=12;source.createdAt='2020-01-01T00:00:00.000Z';
    source.editor.buffers[source.entrypoints.master.fileId!]={text:'invalid: [',baseHash:await digest(source.files[0].bytes)};
    const p=await openProject(await saveProject(source,'old-version'));
    const before=structuredClone(p);
    await session.adopt(p.id,handle('original'));
    await session.save(p,'fork','new-version');await session.save(p,'fork','new-version');
    const first=await openProject(calls[0].bytes),second=await openProject(calls[1].bytes);
    expect(new Set([p.id,first.id,second.id]).size).toBe(3);
    expect(new Set([p.snapshotId,first.snapshotId,second.snapshotId]).size).toBe(3);
    expect(first.name).toBe('来源工程（副本）');expect(first.revision).toBe(0);expect(first.createdAt).not.toBe(p.createdAt);
    expect(first.files).toEqual(p.files);expect(first.editor).toEqual(p.editor);expect(first.entrypoints).toEqual(p.entrypoints);
    expect(first.modules).toEqual(p.modules);expect(first.archiveMetadata?.createdWith.version).toBe('new-version');
    expect(p).toEqual(before);expect(session.project).toBe(p.id);expect(session.handle?.token).toBe('original');
    expect(calls[0].options?.target).toBeUndefined();expect(calls[0].options?.exclude?.token).toBe('original');
    expect(access.release).toHaveBeenCalledWith(handle('chosen-1'));
    await session.save(p,'save','new-version');expect(calls[2].options?.target?.token).toBe('original');
    const saved=await openProject(calls[2].bytes);expect(saved.id).toBe(p.id);expect(saved.snapshotId).not.toBe(p.snapshotId);
    expect(saved.archiveMetadata?.createdWith.version).toBe('old-version');
  });
  it('keeps a damaged source protected through the first save and later save-as/copies, releasing it on workspace replacement',async()=>{
    const {session,access,calls}=fake(),p=createProject('recovered','igh'),source=handle('damaged');
    await session.adopt(p.id,undefined,source);
    await session.save(p,'save','development');expect(calls[0].options?.target).toBeUndefined();expect(calls[0].options?.protectedTargets).toEqual([source]);
    expect(session.handle?.token).toBe('chosen-1');
    await session.save(p,'saveAs','development');expect(calls[1].options?.exclude?.token).toBe('chosen-1');expect(calls[1].options?.protectedTargets).toEqual([source]);
    await session.save(p,'copy','development');expect(calls[2].options?.protectedTargets).toEqual([source]);
    expect(access.release).not.toHaveBeenCalledWith(source);
    await session.adopt('another');expect(access.release).toHaveBeenCalledWith(source);
  });
});

describe('new runtime directory export',()=>{
  it('hashes a reviewed plan and streams each file to a scoped directory transfer without changing project save targets',async()=>{
    const files=[{path:'app/config.yaml',bytes:utf8.encode('config')},{path:'models/empty',bytes:new Uint8Array()},{path:'eni.xml',bytes:new Uint8Array(4*1024**2+1)}];
    const calls:{name:string;args:any;options:any}[]=[];
    const result={displayPath:'/chosen/runtime-new',files:3,warning:null};
    const call=async(name:string,args:any,options:any)=>{calls.push({name,args,options});return name==='choose_directory_export'?'directory':name==='finish_directory_export'?result:undefined;};
    const access=new DesktopFileAccess(call as Invoke);
    expect(await access.writeDirectory(files,'robot')).toEqual(result);expect(access.busy).toBe(false);
    expect(calls[0]).toMatchObject({name:'choose_directory_export',args:{name:'robot',entries:[{path:'app/config.yaml',size:6,sha256:await digest(files[0].bytes)},{path:'models/empty',size:0},{path:'eni.xml',size:4*1024**2+1}]}});
    const chunks=calls.filter(c=>c.name==='write_directory_chunk');expect(chunks.map(c=>c.args.length)).toEqual([6,4*1024**2,1]);
    expect(chunks[2].options.headers).toEqual({'x-transfer-id':'directory','x-file-index':'2','x-offset':String(4*1024**2)});
    expect(calls.some(c=>['choose_target','begin_write','cancel_directory_export'].includes(c.name))).toBe(false);
  });
  it('cancels staging after cancellation or write failure and does not finish incomplete exports',async()=>{
    for(const fail of [false,true]){
      const controller=new AbortController(),calls:string[]=[];
      const call=async(name:string)=>{calls.push(name);if(name==='choose_directory_export')return 'directory';if(name==='write_directory_chunk'){if(fail)throw {code:'io',message:'disk full'};controller.abort();}};
      const access=new DesktopFileAccess(call as Invoke);
      await expect(access.writeDirectory([{path:'a',bytes:utf8.encode('x')}],'r',{signal:controller.signal})).rejects.toMatchObject(fail?{code:'io'}:{name:'AbortError'});
      expect(calls).toContain('cancel_directory_export');expect(calls).not.toContain('finish_directory_export');expect(access.busy).toBe(false);
    }
  });
  it('honors a cancelled picker, rejects unsafe paths before a dialog and reports cleanup failures',async()=>{
    const call=vi.fn(async()=>null),access=new DesktopFileAccess(call as Invoke);
    expect(await access.writeDirectory([{path:'a',bytes:utf8.encode('x')}],'r')).toBeUndefined();expect(call).toHaveBeenCalledTimes(1);
    await expect(access.writeDirectory([{path:'../escape',bytes:new Uint8Array()}],'r')).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
    const failing=async(name:string)=>{if(name==='choose_directory_export')return 'directory';if(name==='write_directory_chunk'||name==='cancel_directory_export')throw {code:'io',message:'read-only filesystem'};};
    await expect(new DesktopFileAccess(failing as Invoke).writeDirectory([{path:'a',bytes:utf8.encode('x')}],'r')).rejects.toMatchObject({code:'cleanup'});
  });
  it('blocks closing while a directory picker is active and does not retract a successful commit after an abort',async()=>{
    let choose!:(s:string)=>void;const controller=new AbortController();
    const call=async(name:string)=>{if(name==='choose_directory_export')return new Promise<string>(resolve=>choose=resolve);if(name==='finish_directory_export'){controller.abort();return {displayPath:'/chosen/done',files:1};}};
    const access=new DesktopFileAccess(call as Invoke),writing=access.writeDirectory([{path:'empty',bytes:new Uint8Array()}],'r',{signal:controller.signal});
    await expect(access.close()).rejects.toMatchObject({code:'busy'});
    await vi.waitFor(()=>expect(choose).toBeTypeOf('function'));choose('transfer');
    expect(await writing).toEqual({displayPath:'/chosen/done',files:1});expect(access.busy).toBe(false);
  });
});
