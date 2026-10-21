import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { analysisInput, analyzeProject, sameAnalysisInput } from '../src/core/project/analysis';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { hardwareChain } from '../src/core/hardware/edit';
import { createProject, makeFile } from '../src/core/project/create';
import { resourceProject } from './fixtures/resources';
import { fileById, utf8 } from '../src/core/project/types';

describe('revision-bound bus and robot views',()=>{
  it('reuses only identical parsed inputs, excluding metadata and unapplied buffers while including profiles and XML encoding',()=>{
    const p=resourceProject(),old=analysisInput(p),next=structuredClone(p);next.revision++;next.name='metadata change';next.editor.buffers[p.entrypoints.urdf!]={text:'new draft',baseHash:'old'};
    expect(sameAnalysisInput(old,analysisInput(next))).toBe(true);
    fileById(next,next.entrypoints.urdf)!.encoding='utf-16le';expect(sameAnalysisInput(old,analysisInput(next))).toBe(false);
    const ruleChange=structuredClone(p);fileById(ruleChange,ruleChange.targets.master.profile!.fileId)!.bytes[0]=0;
    expect(sameAnalysisInput(old,analysisInput(ruleChange))).toBe(false);
    const xmlChange=structuredClone(p);fileById(xmlChange,xmlChange.entrypoints.urdf)!.bytes[1]=0;
    expect(sameAnalysisInput(old,analysisInput(xmlChange))).toBe(false);
  });
  it('produces structured-cloneable views matching core consumers without copying resources or source drafts',()=>{
    const p=resourceProject();p.revision=9;
    p.files.push(makeFile('large.bin','resource','large resource'));p.editor.buffers[p.entrypoints.urdf!]={text:'not applied',baseHash:'old'};
    const input=analysisInput(p),view=analyzeProject(input,17);
    expect(input.files.some(file=>file.path==='large.bin')).toBe(false);expect(input.editor.buffers).toEqual({});expect(input.archiveMetadata).toBeUndefined();
    expect(view.catalog).toEqual(buildBusCatalog(p));expect(view.chain).toEqual(hardwareChain(p));
    expect(view).toMatchObject({projectId:p.id,revision:9,workspaceEpoch:17});
    expect(view.robot).not.toHaveProperty('doc');expect(structuredClone(view)).toEqual(view);
    expect(p.editor.buffers[p.entrypoints.urdf!].text).toBe('not applied');
  });
  it('parses ECM process images in the same task without changing ENI bytes',async()=>{
    const p=createProject('ecm','ecm'),bytes=new Uint8Array(await readFile('tests/fixtures/eni-seven-drives.xml'));
    const file=makeFile('master/eni.xml','eni','');file.bytes=bytes;p.files.push(file);p.entrypoints.master.eniFileId=file.id;
    const result=analyzeProject(analysisInput(p),1);
    expect(result.catalog.slaves).toHaveLength(7);expect(result.catalog.signals.filter(s=>s.direction==='input')).toHaveLength(56);
    expect(result.catalog.signals.filter(s=>s.direction==='output')).toHaveLength(35);expect(file.bytes).toEqual(bytes);
  });
  it('reports malformed URDF independently and never invents a chain for cycles or unsupported joints',()=>{
    const p=resourceProject(),urdf=fileById(p,p.entrypoints.urdf)!;
    urdf.bytes=utf8.encode('<robot>');let result=analyzeProject(analysisInput(p),1);
    expect(result.robot).toBeUndefined();expect(result.robotError).toBeTruthy();expect(result.chain).toEqual([]);expect(result.catalog.slaves).toHaveLength(1);
    urdf.bytes=utf8.encode('<robot name="bad"><link name="base"/><joint name="loop" type="fixed"><parent link="base"/><child link="base"/></joint></robot>');
    result=analyzeProject(analysisInput(p),2);expect(result.robot?.errors.some(e=>e.includes('环'))).toBe(true);expect(result.chainError).toBeTruthy();expect(result.chain).toEqual([]);
  });
});
