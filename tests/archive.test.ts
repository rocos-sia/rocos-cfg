import { describe, it, expect } from 'vitest';
import { createProject, makeFile } from '../src/core/project/create';
import { openProject, saveProject } from '../src/core/project/archive';
import { packZip, unpackZip, LIMITS } from '../src/core/project/zip';
import { utf8, textOf, digest } from '../src/core/project/types';
import { patchYaml, readYaml } from '../src/core/documents/yaml';
import { resolvePath } from '../src/core/project/paths';

describe('portable project archive', () => {
  it('restores edited documents, binary resources and unapplied drafts without browser state', async () => {
    const p=createProject('七轴机械臂','ecm');
    const eni=makeFile('master/eni.xml','eni','<?xml version="1.0"?><EtherCATConfig Version="1.3"><!-- preserve --></EtherCATConfig>');
    p.files.push(eni, {id:'mesh',path:'models/meshes/轴.stl',role:'resource',owner:'resource',bytes:new Uint8Array([0,255,3,42])});p.entrypoints.master.eniFileId=eni.id;
    const app=p.files.find(f=>f.role==='app')!;
    p.editor.buffers[app.id]={text:'robot: [broken',baseHash:await digest(app.bytes)};
    const restored=await openProject(await saveProject(p));
    expect(restored.id).toBe(p.id);expect(restored.name).toBe(p.name);
    expect(restored.files.find(f=>f.id===eni.id)?.bytes).toEqual(eni.bytes);
    expect(restored.files.find(f=>f.id==='mesh')?.bytes).toEqual(new Uint8Array([0,255,3,42]));
    expect(restored.editor).toEqual(p.editor);expect(restored.references.some(r=>r.state==='missing')).toBe(true);
  });
  it('rejects tampered payloads even when the ZIP itself is valid',async()=>{
    const bytes=await saveProject(createProject('p','igh'));const files=unpackZip(bytes);
    files.set('master/igh.yaml',utf8.encode('version: 2\n'));
    await expect(openProject(packZip(files))).rejects.toThrow(/长度|SHA-256/);
  });
  it('rejects unknown format and invalid entrypoints without modifying an existing project',async()=>{
    const p=createProject('original','igh');const files=unpackZip(await saveProject(p));
    const m=JSON.parse(new TextDecoder().decode(files.get('rocos-project.json')));m.entrypoints.master.fileId='missing';
    files.set('rocos-project.json',utf8.encode(JSON.stringify(m)));
    await expect(openProject(packZip(files))).rejects.toThrow('入口');expect(p.name).toBe('original');
    m.formatVersion=999;files.set('rocos-project.json',utf8.encode(JSON.stringify(m)));
    await expect(openProject(packZip(files))).rejects.toThrow('版本');
  });
  it('enforces unpacked limits before decompression and rejects truncated archives',async()=>{
    const bytes=await saveProject(createProject('p','igh'));
    await expect(openProject(bytes,{...LIMITS,file:16})).rejects.toThrow('限额');
    await expect(openProject(bytes.slice(0,-6))).rejects.toThrow(/截断|损坏/);
  });
  it('rejects path traversal and case-fold collisions',()=>{
    expect(()=>packZip(new Map([['../escape',utf8.encode('x')]]))).toThrow('路径');
    expect(()=>packZip(new Map([['A.yaml',new Uint8Array()],['a.yaml',new Uint8Array()]]))).toThrow('冲突');
    expect(resolvePath('app/config.yaml','../models/robot.urdf')).toBe('models/robot.urdf');
    expect(resolvePath('app/config.yaml','../../private')).toBeUndefined();
  });
  it('preserves comments and exact 64-bit SDO values in YAML edits',()=>{
    const input='# header\nvalue: 18446744073709551615\nmaster:\n  cycle: 1000 # keep\n';
    const out=patchYaml(input,['master','cycle'],2000);
    expect(out).toContain('# header');expect(out).toContain('# keep');expect(readYaml(out).value).toBe(18446744073709551615n);
  });
});
