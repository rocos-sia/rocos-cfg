import { analysisInput } from '../src/core/project/analysis';
import { targetStatus } from '../src/core/project/profiles';
import oldProfiles from '../templates/profiles/targets.v1.json';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createProject, makeFile } from '../src/core/project/create';
import { teachingTemplate } from '../src/core/project/templates';
import { createExample } from '../src/core/project/examples';
import { configuration, configure, masterProject, synchronizeBus } from '../src/core/project/configuration';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { buildIghCatalog } from '../src/core/bus/igh';
import { readIghEni } from '../src/core/bus/igh-eni';
import { planEniImport } from '../src/core/bus/eni-import';
import { planSlaveChange, editProjectYaml } from '../src/core/bus/igh-edit';
import { collectReferences } from '../src/core/project/references';
import { moveResource } from '../src/core/project/resources';
import { readYaml } from '../src/core/documents/yaml';
import { exportMaster, planRuntime } from '../src/core/export';
import { unpackZip } from '../src/core/project/zip';
import { inspectImport, applyImport } from '../src/core/project/import';

it('generates the common ENI startup shape and keeps topology external',()=>{
 const p=createProject('new ENI','igh'),data=readYaml(textOf(fileById(p,p.entrypoints.master.fileId)!));
 expect(data).toMatchObject({eni:'eni.xml',id:0n,cycle:1000n,cpuidx:null});
 expect(data.master).toBeUndefined();expect(data.slaves).toBeUndefined();
 expect(buildBusCatalog(p).diagnostics.some(d=>d.code==='eni.missing')).toBe(true);
 expect(()=>planSlaveChange(p,{kind:'add'})).toThrow('只读');
});
it('imports startup YAML unambiguously by explicit target and links its relative ENI',()=>{
 const base=createProject('import','igh');
 const entries=new Map([['robot/igh.yaml',utf8.encode('eni: bus/network.xml\nid: 7\ncycle: 1000')],['robot/bus/network.xml',utf8.encode(teachingTemplate().data.eni)]]);
 const plan=inspectImport(base,entries,false,undefined,'igh'),p=applyImport(base,plan);
 expect(p.entrypoints.master.kind).toBe('igh');
 expect(p.entrypoints.master.eniFileId).toBe(p.files.find(f=>f.path==='robot/bus/network.xml')?.id);
 expect(buildBusCatalog(p).diagnostics).toEqual([]);expect(buildBusCatalog(p).masterId).toBe(7);
 expect(inspectImport(base,entries).files.find(f=>f.path.endsWith('igh.yaml'))?.role).toBe('igh');
});
it('retains vendor startup settings and flattens legacy parameters when replacing topology',()=>{
 const base=createProject('legacy','igh',{pdoTemplate:'drive-talon'}),id=base.entrypoints.master.fileId!;
 editProjectYaml(base,id,doc=>{doc.setIn(['master','master_id'],4);doc.setIn(['master','cpu'],63);doc.setIn(['master','op_timeout_ms'],90000);});
 const {project,overwrite}=planEniImport(base,utf8.encode(teachingTemplate().data.eni));
 expect(overwrite).toBe(true);
 const data=readYaml(textOf(fileById(project,id)!));
 expect(data).toMatchObject({id:4n,cycle:1000n,cpuidx:63n,op_timeout_ms:90000n});
 expect(data.master).toBeUndefined();expect(data.slaves).toBeUndefined();
 expect(masterProject(project,'ecm').entrypoints.master.eniFileId).toBe(project.entrypoints.master.eniFileId);
 synchronizeBus(project,5,2000);
 for(const kind of ['igh','ecm'] as const)expect(buildBusCatalog(masterProject(project,kind))).toMatchObject({masterId:5,cycleUs:2000});
});
it('exports a standalone startup package and runtime ENI with exact original bytes after relocation',()=>{
 const p=createExample('igh'),eni=fileById(p,p.entrypoints.master.eniFileId)!;
 const original=new Uint8Array(eni.bytes);
 moveResource(p,eni.id,'network/shared.xml');
 expect(buildBusCatalog(analysisInput(p))).toEqual(buildBusCatalog(p));
 const files=unpackZip(exportMaster(p)),yaml=readYaml(new TextDecoder().decode(files.get('master/igh.yaml')));
 expect(yaml.eni).toBe('../network/shared.xml');expect(files.get('network/shared.xml')).toEqual(original);
 configure(p).enabled.app=false;
 expect(planRuntime(p).files.find(f=>f.path==='network/shared.xml')?.bytes).toEqual(original);
 expect(collectReferences(p).find(r=>r.sourceFileId===p.entrypoints.master.fileId&&r.field==='eni')?.state).toBe('internal');
});
it('defaults absent Cyclic/DC, accepts input-only devices and uses physical AutoIncAddr order',()=>{
 const text=teachingTemplate().data.eni;
 const bytes=utf8.encode(text.replace(/<RxPdo[\s\S]*?<\/RxPdo>/g,''));
 expect(readIghEni(bytes).master).toMatchObject({period_us:1000,dc:'off'});
 expect(readIghEni(bytes).slaves[0].rx_pdos).toEqual([]);
 const slave=/<Slave>[\s\S]*?<\/Slave>/.exec(text)![0];
 const second=slave.replace('<AutoIncAddr>0</AutoIncAddr>','<AutoIncAddr>65535</AutoIncAddr>').replace('<PhysAddr>1001</PhysAddr>','<PhysAddr>1002</PhysAddr>').replace('<Name>Teaching Drive</Name>','<Name>Second</Name>');
 const parsed=readIghEni(utf8.encode(text.replace(slave,second+slave)));
 expect(parsed.slaves.map(s=>[s.id,s.name])).toEqual([[0,'Teaching Drive'],[1,'Second']]);
});
it('applies ENI cycle/DC defaults, reports override mismatches and rejects unsafe ENI without mutation',async()=>{
 const bytes=new Uint8Array(await readFile(new URL('../public/examples/talon/ecm/eni7.xml',import.meta.url)));
 const eni=makeFile('network.xml','eni','');eni.bytes=bytes;
 const startup=makeFile('igh.yaml','igh','eni: network.xml\n');
 expect(buildIghCatalog(startup,eni).diagnostics).toEqual([]);
 startup.bytes=utf8.encode('eni: network.xml\ncycle: 2000\n');
 expect(buildIghCatalog(startup,eni).diagnostics.some(d=>d.code==='igh.cycle')).toBe(true);
 startup.bytes=utf8.encode('eni: network.xml\ncycle: 2000\ndc: off\n');
 expect(buildIghCatalog(startup,eni).diagnostics).toEqual([]);
 const base=createProject('atomic','igh'),before=structuredClone(base),text=teachingTemplate().data.eni;
 for(const invalid of [text.replace('<VendorId>1</VendorId>','<VendorId>0</VendorId>'),text.replace('<BitLen>16</BitLen>','<BitLen>1</BitLen>'),text.replace('<AutoIncAddr>0</AutoIncAddr>','<AutoIncAddr>65535</AutoIncAddr>')])expect(()=>planEniImport(base,utf8.encode(invalid))).toThrow();
 expect(base).toEqual(before);
 expect(configuration(base).masters).toEqual({});
});

it('retains old profile snapshots and upgrades the consumer rules only on explicit ENI import',()=>{
 const p=createProject('legacy profile','igh',{pdoTemplate:'drive-talon'}),snapshot=fileById(p,p.targets.master.profile!.fileId)!;
 snapshot.bytes=utf8.encode(JSON.stringify(oldProfiles.igh));
 p.targets.master={...oldProfiles.igh.target,profile:{id:'rocos.igh',version:1,fileId:snapshot.id}};
 expect(targetStatus(p,'master').supported).toBe(true);
 const next=planEniImport(p,utf8.encode(teachingTemplate().data.eni)).project;
 expect(next.targets.master.version).toBe('9001c87');expect(targetStatus(next,'master').supported).toBe(true);
 expect(fileById(next,snapshot.id)!.bytes).toEqual(snapshot.bytes);
});

it('requires overwrite review when ENI is resolved from YAML even without an entrypoint cache',()=>{
 const p=createExample('igh');p.entrypoints.master.eniFileId=null;
 expect(planEniImport(p,utf8.encode(teachingTemplate().data.eni)).overwrite).toBe(true);
});

it('accepts arbitrary unique ECM station addresses and rejects zero or duplicate addresses',async()=>{
 const p=createExample('ecm'),eni=fileById(p,p.entrypoints.master.eniFileId)!;
 eni.bytes=utf8.encode(textOf(eni).replace('<PhysAddr>1001</PhysAddr>','<PhysAddr>60000</PhysAddr>'));
 expect(buildBusCatalog(p).diagnostics).toEqual([]);
 eni.bytes=utf8.encode(textOf(eni).replace('<PhysAddr>60000</PhysAddr>','<PhysAddr>0</PhysAddr>'));
 expect(buildBusCatalog(p).diagnostics.some(d=>d.code==='ecm.address')).toBe(true);
 eni.bytes=new Uint8Array(await readFile(new URL('../public/examples/talon/ecm/eni7.xml',import.meta.url)));
 eni.bytes=utf8.encode(textOf(eni).replace('<PhysAddr>1002</PhysAddr>','<PhysAddr>1001</PhysAddr>'));
 expect(buildBusCatalog(p).diagnostics.some(d=>d.code==='ecm.address')).toBe(true);
});
