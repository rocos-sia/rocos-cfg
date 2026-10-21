import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { inspectProjectRecovery } from '../src/core/project/recover';
import { openProject, saveProject } from '../src/core/project/archive';
import { createProject, makeFile } from '../src/core/project/create';
import { inspectZip, LIMITS, packZip, unpackZip } from '../src/core/project/zip';
import { digest, utf8 } from '../src/core/project/types';
import { validateProject } from '../src/core/validation';
import { readonlyFile, validateModules } from '../src/core/modules/project';

describe('explicit damaged archive recovery',()=>{
  it('restores only hash-verified files to a new draft, clears approvals and retains valid source buffers and ENI bytes',async()=>{
    const p=createProject('damaged robot','ecm'),eni=makeFile('master/eni.xml','eni','<!-- ENI retained -->\r\n<EtherCATConfig/>');
    const bad=makeFile('resources/bad.txt','attachment','original'),good=makeFile('resources/good.bin','attachment','verified binary');
    p.files.push(eni,bad,good);p.entrypoints.master.eniFileId=eni.id;
    p.editor.confirmations['drive:0']=true;p.editor.buffers[p.entrypoints.app!]={text:'invalid: [',baseHash:await digest(p.files.find(f=>f.id===p.entrypoints.app)!.bytes)};
    const entries=unpackZip(await saveProject(p));entries.set(bad.path,utf8.encode('modified'));
    entries.delete('app/hardware_config.yaml');entries.set('unlisted.txt',utf8.encode('not registered'));
    const broken=packZip(entries),before=new Uint8Array(broken);
    await expect(openProject(broken)).rejects.toThrow();
    const result=await inspectProjectRecovery(broken),reopened=await openProject(await saveProject(result.project));
    expect(result.source.id).toBe(p.id);expect(reopened.id).not.toBe(p.id);expect(reopened.name).toBe('damaged robot（恢复）');expect(reopened.revision).toBe(0);
    expect(reopened.files.find(f=>f.id===eni.id)?.bytes).toEqual(eni.bytes);expect(reopened.files.find(f=>f.id===eni.id)?.role).toBe('eni');
    expect(reopened.files.find(f=>f.id===good.id)?.bytes).toEqual(good.bytes);
    expect(reopened.files.some(f=>f.id===bad.id||f.path==='unlisted.txt')).toBe(false);
    expect(reopened.entrypoints.hardware).toBeNull();expect(reopened.editor.buffers).toEqual(p.editor.buffers);expect(reopened.editor.confirmations).toEqual({});
    expect(result.records.find(r=>r.path===bad.path)?.status).toBe('damaged');
    expect(result.records.find(r=>r.path==='app/hardware_config.yaml')?.status).toBe('missing');
    expect(result.records.find(r=>r.path==='unlisted.txt')?.status).toBe('unlisted');
    const report=JSON.parse(new TextDecoder().decode(reopened.files.find(f=>f.path.endsWith('/report.json'))!.bytes));
    expect(report.sourceHash).toBe(await digest(broken));expect(report.newProjectId).toBe(reopened.id);
    expect(validateProject(reopened).some(d=>d.code==='entrypoint.missing')).toBe(true);
    expect(broken).toEqual(before);expect(p.editor.confirmations['drive:0']).toBe(true);
  });
  it('isolates a CRC failure and salvages complete local records when the central directory is truncated',async()=>{
    const p=createProject('crc and truncation','igh'),entries=unpackZip(await saveProject(p));
    const bytes=zipSync(Object.fromEntries(entries),{level:0});
    const file=inspectZip(bytes).find(f=>f.path==='master/igh.yaml')!;
    const damaged=new Uint8Array(bytes);damaged[file.body]^=1;
    await expect(openProject(damaged)).rejects.toThrow('校验');
    const recovery=await inspectProjectRecovery(damaged);expect(recovery.project.entrypoints.master.fileId).toBeNull();
    expect(recovery.records.find(r=>r.path===file.path)?.message).toContain('CRC');
    const end=new DataView(bytes.buffer).getUint32(bytes.length-6,true);
    const truncated=bytes.slice(0,end+12);
    await expect(openProject(truncated)).rejects.toThrow('截断');
    const salvaged=await inspectProjectRecovery(truncated);
    expect(salvaged.notes.some(n=>n.includes('中央目录'))).toBe(true);
    expect(salvaged.project.entrypoints).toEqual(p.entrypoints);
    for(const f of p.files)expect(salvaged.project.files.find(x=>x.id===f.id)?.bytes).toEqual(f.bytes);
  });
  it('keeps a partial optional module as original attachments and does not reinterpret it as a supported module',async()=>{
    const p=createProject('vendor','igh'),one=makeFile('vendor/one.yaml','vendor.custom','secret: one'),two=makeFile('vendor/two.yaml','vendor.custom','secret: two');
    one.owner=two.owner='vendor.custom';p.files.push(one,two);
    p.modules=[{id:'vendor.custom',version:10,required:false,fileIds:[one.id,two.id],vendor:{opaque:true}}];
    const entries=unpackZip(await saveProject(p));entries.delete(two.path);
    const result=await inspectProjectRecovery(packZip(entries));
    const quarantined=result.project.files.find(f=>f.id===one.id)!;
    expect(quarantined).toMatchObject({role:'attachment',owner:'recovery.quarantine',bytes:one.bytes});
    expect(readonlyFile(result.project,quarantined)).toBe(true);
    expect(validateModules(result.project,new Set([one.id])).some(d=>d.code==='module.unsupported'&&d.severity==='error')).toBe(true);
    expect(result.project.modules?.some(m=>m.id==='vendor.custom')).toBe(false);
    const original=JSON.parse(new TextDecoder().decode(result.project.files.find(f=>f.path.endsWith('/original-manifest.json'))!.bytes));
    expect(original.modules.find((m:any)=>m.id==='vendor.custom')).toEqual(p.modules[0]);
  });
  it('does not silently remove runtime requirements when all files of a runtime module are lost',async()=>{
    const p=createProject('required runtime','igh'),file=makeFile('runtime/opaque.yaml','vendor.runtime','x: 1');file.owner='vendor.runtime';p.files.push(file);
    p.modules=[{id:'vendor.runtime',version:1,required:false,requiredForRuntime:true,fileIds:[file.id]}];
    const entries=unpackZip(await saveProject(p));entries.delete(file.path);
    const result=await inspectProjectRecovery(packZip(entries));
    expect(result.project.modules?.find(m=>m.id==='recovery.quarantine')).toMatchObject({requiredForRuntime:true,fileIds:[]});
    expect(validateProject(result.project).some(d=>d.code==='module.unsupported'&&d.severity==='error')).toBe(true);
  });
  it('refuses unverifiable manifests, unsafe paths, limits and unknown required contracts without altering the input',async()=>{
    const entries=unpackZip(await saveProject(createProject('safe','igh'))),manifest=JSON.parse(new TextDecoder().decode(entries.get('rocos-project.json')));
    const input=zipSync(Object.fromEntries([...entries,['../escape',utf8.encode('x')]]));
    await expect(inspectProjectRecovery(input)).rejects.toThrow('路径');
    await expect(inspectProjectRecovery(packZip(entries),{...LIMITS,file:8})).rejects.toThrow('限额');
    manifest.formatVersion=2;entries.set('rocos-project.json',utf8.encode(JSON.stringify(manifest)));
    await expect(inspectProjectRecovery(packZip(entries))).rejects.toThrow('版本');
    manifest.formatVersion=1;manifest.modules[0].version=100;entries.set('rocos-project.json',utf8.encode(JSON.stringify(manifest)));
    await expect(inspectProjectRecovery(packZip(entries))).rejects.toThrow('必要模块');
    entries.delete('rocos-project.json');await expect(inspectProjectRecovery(packZip(entries))).rejects.toThrow('manifest');
  });
  it('does not turn real decompression overruns or symbolic links into recoverable file warnings',async()=>{
    const p=createProject('limits','igh');p.files.push(makeFile('bomb.txt','attachment','x'.repeat(100000)));
    const bytes=await saveProject(p),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const entry=inspectZip(bytes).find(e=>e.path==='bomb.txt')!;
    view.setUint32(entry.offset+22,1,true);
    const central=view.getUint32(bytes.length-6,true);let pos=central;
    while(view.getUint32(pos,true)===0x02014b50){
      const length=view.getUint16(pos+28,true),name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+length));
      if(name==='bomb.txt'){view.setUint32(pos+24,1,true);break;}
      pos+=46+length+view.getUint16(pos+30,true)+view.getUint16(pos+32,true);
    }
    await expect(inspectProjectRecovery(bytes,{...LIMITS,file:32768})).rejects.toThrow('实际解压量超限');
    view.setUint32(pos+38,0xa1ff0000,true);
    await expect(inspectProjectRecovery(bytes)).rejects.toThrow('符号链接');
  });
});
