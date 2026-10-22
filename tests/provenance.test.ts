import { describe, expect, it } from 'vitest';
import legacyProfiles from '../templates/profiles/targets.v1.json' with {type:'json'};
import legacyStarter from '../templates/projects/starter.v1.json' with {type:'json'};
import { createProject } from '../src/core/project/create';
import { attachProfile, baseTarget, targetStatus, validateProfiles } from '../src/core/project/profiles';
import { validateTemplates } from '../src/core/project/templates';
import { openProject, saveProject } from '../src/core/project/archive';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { readRobot, controlChain } from '../src/core/documents/urdf';
import { readYaml, patchYaml } from '../src/core/documents/yaml';
import { planSlaveChange } from '../src/core/bus/igh-edit';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { prepareRuntime } from '../src/core/export';
import { resourceProject } from './fixtures/resources';

describe('versioned rules and structured template snapshots',()=>{
  it('archives the exact seed and target profiles while keeping ECM optional services disabled',async()=>{
    const p=createProject('ECM','ecm'),restored=await openProject(await saveProject(p));
    expect(validateProfiles(restored)).toEqual([]);expect(validateTemplates(restored)).toEqual([]);
    expect(restored.files.filter(f=>f.role==='profile')).toHaveLength(2);expect(restored.files.filter(f=>f.role==='template')).toHaveLength(1);
    const config=readYaml(textOf(fileById(restored,restored.entrypoints.master.fileId)!));
    expect([config.sp,config.flash,config.mbxsrv]).toEqual([null,null,null]);expect(config.license).toBe('');
    for(const file of p.files)expect(fileById(restored,file.id)?.bytes).toEqual(file.bytes);
    expect(restored.editor.templateUses).toEqual(p.editor.templateUses);
  });
  it('retains old ECM snapshots and numeric configuration until explicit retargeting',async()=>{
    const p=createProject('legacy ECM','ecm');
    const profile=fileById(p,p.targets.master.profile!.fileId)!, master=fileById(p,p.entrypoints.master.fileId)!;
    profile.path='project-data/profiles/rocos.ecm.v1.json';profile.bytes=utf8.encode(JSON.stringify(legacyProfiles.ecm));
    p.targets.master={...legacyProfiles.ecm.target,profile:{id:'rocos.ecm',version:1,fileId:profile.id}};
    const use=p.editor.templateUses![0],template=fileById(p,use.snapshotFileId)!;
    use.version=1;template.path='project-data/templates/project.starter.v1.json';template.bytes=utf8.encode(JSON.stringify(legacyStarter));
    master.bytes=utf8.encode('eni: eni.xml\nlink: 2\n');
    const restored=await openProject(await saveProject(p));
    expect(targetStatus(restored,'master').supported).toBe(false);expect(validateTemplates(restored)).toEqual([]);
    expect(textOf(fileById(restored,master.id)!)).toBe('eni: eni.xml\nlink: 2\n');
    expect(buildBusCatalog(restored).signals).toEqual([]);
    expect(()=>prepareRuntime(restored)).toThrow();
    restored.targets.master=baseTarget('ecm');attachProfile(restored,'master',true);
    expect(fileById(restored,profile.id)!.bytes).toEqual(profile.bytes);
    expect(buildBusCatalog(restored).diagnostics.some(d=>d.code==='ecm.startup'&&d.field==='link')).toBe(true);
  });
  it('generates an editable robot from data, records parameter overrides and never reapplies a template on reopen',async()=>{
    const p=createProject('arm','igh',{robotTemplate:'robot.two-axis',parameters:{prefix:'test',linkLength:0.6}}),urdf=fileById(p,p.entrypoints.urdf)!;
    expect(readRobot(textOf(urdf)).errors).toEqual([]);expect(controlChain(textOf(urdf),'test_base','test_link_2')).toHaveLength(2);
    expect(textOf(urdf)).toContain('0.6 0.05 0.05');
    expect(p.editor.templateUses?.find(t=>t.templateId==='robot.two-axis')).toMatchObject({parameters:{prefix:'test',linkLength:0.6},overrides:{prefix:'test',linkLength:0.6}});
    urdf.bytes=utf8.encode(textOf(urdf).replace('upper="1.57"','upper="0.9"'));
    const saved=await openProject(await saveProject(p));expect(fileById(saved,urdf.id)?.bytes).toEqual(urdf.bytes);
    expect(saved.editor.templateUses).toEqual(p.editor.templateUses);expect(readYaml(textOf(fileById(saved,saved.entrypoints.hardware)!)).hardware).toEqual([]);
  });
  it('blocks altered or unsupported rule snapshots and keeps ordinary project files editable and archivable',async()=>{
    const p=resourceProject(),profile=fileById(p,p.targets.master.profile!.fileId)!;
    const value=JSON.parse(textOf(profile));value.rules.maxSlaves=500;profile.bytes=utf8.encode(JSON.stringify(value));
    const restored=await openProject(await saveProject(p));
    expect(targetStatus(restored,'master').supported).toBe(false);expect(buildBusCatalog(restored).signals).toEqual([]);
    expect(()=>prepareRuntime(restored)).toThrow('错误');expect(fileById(restored,p.entrypoints.urdf)?.bytes).toEqual(fileById(p,p.entrypoints.urdf)?.bytes);
    restored.targets.master.profile!.version=99;expect(targetStatus(restored,'master').message).toContain('没有对应适配器');
  });
  it('permits explicitly saving a legacy rule snapshot without changing documents, and preserves old profiles when retargeting',()=>{
    const p=resourceProject(),original=new Map(p.files.map(f=>[f.id,new Uint8Array(f.bytes)]));
    p.targets.master=baseTarget('igh');expect(targetStatus(p,'master')).toMatchObject({supported:true,legacy:true});
    attachProfile(p,'master');expect(targetStatus(p,'master')).toMatchObject({supported:true,legacy:false});
    for(const [id,bytes]of original)expect(fileById(p,id)?.bytes).toEqual(bytes);
    const old=p.targets.master.profile!.fileId;p.targets.master=baseTarget('igh');attachProfile(p,'master',true);
    expect(p.targets.master.profile!.fileId).not.toBe(old);expect(fileById(p,old)).toBeDefined();
  });
  it('keeps unknown template versions as history without using them to regenerate files or exporting any tool snapshots',async()=>{
    const p=resourceProject(),use=p.editor.templateUses![0],file=fileById(p,use.snapshotFileId)!;
    const template=JSON.parse(textOf(file));template.version=999;template.data.robot.name='should-not-run';use.version=999;file.bytes=utf8.encode(JSON.stringify(template));
    const restored=await openProject(await saveProject(p));expect(validateTemplates(restored)[0].message).toContain('不在当前库');
    expect(fileById(restored,p.entrypoints.urdf)?.bytes).toEqual(fileById(p,p.entrypoints.urdf)?.bytes);
    const runtime=prepareRuntime(restored);expect(runtime.plan.files.some(f=>f.path.startsWith('project-data/'))).toBe(false);
    expect(runtime.plan.files.some(f=>f.fileId&&restored.files.some(original=>original.id===f.fileId&&['profile','template'].includes(original.role)))).toBe(false);
  });
  it('records only actually applied device templates while preserving comments and exact existing SDO values',()=>{
    const p=resourceProject(),file=fileById(p,p.entrypoints.master.fileId)!;file.bytes=utf8.encode('# retained header\n'+patchYaml(textOf(file),['slaves',0,'init_commands'],[{index:0x2000,sub_index:0,Type:'uint64',Value:18446744073709551615n}]));
    const next=planSlaveChange(p,{kind:'add'}).project;
    expect(textOf(fileById(next,file.id)!)).toContain('# retained header');
    expect(readYaml(textOf(fileById(next,file.id)!)).slaves[0].init_commands[0].Value).toBe(18446744073709551615n);
    const use=next.editor.templateUses?.find(t=>t.templateId==='device.igh-discovery');expect(use?.outputs).toEqual([file.id]);
    expect(p.editor.templateUses?.some(t=>t.templateId==='device.igh-discovery')).toBe(false);
    const slave=readYaml(textOf(fileById(next,file.id)!)).slaves[1];expect(slave.rx_pdos[0].entries).toEqual([]);expect(slave.init_commands).toEqual([]);
    expect(buildBusCatalog(next).diagnostics.some(d=>d.code==='igh.discovery')).toBe(false);
  });
  it('marks an archive with missing profile/template snapshots incomplete rather than inventing replacements',async()=>{
    const p=createProject('missing','igh'),id=p.targets.master.profile!.fileId;p.files=p.files.filter(f=>f.id!==id);
    const restored=await openProject(await saveProject(p));expect(restored.archiveMetadata?.portability).toMatchObject({state:'incomplete',missingSnapshots:[id]});
    expect(targetStatus(restored,'master').supported).toBe(false);
  });
});
