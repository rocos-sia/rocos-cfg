import { describe,it,expect } from 'vitest';
import { createExample } from '../src/core/project/examples';
import { createProject,makeFile } from '../src/core/project/create';
import { configuration,configure,selectMaster,masterKinds,masterProject,enableSimulation,applicationProject,synchronizeBus } from '../src/core/project/configuration';
import { validateProject } from '../src/core/validation';
import { activeFileIds } from '../src/core/project/references';
import { planRuntime } from '../src/core/export';
import { saveProject,openProject } from '../src/core/project/archive';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { fileById,utf8 } from '../src/core/project/types';
import { planHardware } from '../src/core/hardware/edit';

describe('optional configuration modules',()=>{
 it('exports a bus-only project without requiring APP/URDF/hardware',()=>{
  const p=createExample('igh');configure(p).enabled.app=false;
  expect(validateProject(p).filter(d=>d.severity==='error')).toEqual([]);
  const plan=planRuntime(p);expect(plan.files.some(f=>f.path==='master/igh.yaml')).toBe(true);expect(plan.files.some(f=>f.path.startsWith('app/'))).toBe(false);
 });
 it('supports manual hardware and mappings without a bus',()=>{
  const p=createExample('igh');configure(p).enabled.bus=false;
  const errors=validateProject(p).filter(d=>d.code==='master.missing'||d.code==='hardware.signal'||d.code==='hardware.id');expect(errors).toEqual([]);
  const next=planHardware(p,{kind:'add',id:99,type:'io'}).project;expect(next).toBeDefined();
  expect(activeFileIds(p).has(p.entrypoints.master.fileId!)).toBe(false);
 });
 it('keeps dual masters and APP source independent through archive roundtrip',async()=>{
  const p=createExample('ecm');const ecmId=p.entrypoints.master.fileId,eniId=p.entrypoints.master.eniFileId;
  selectMaster(p,'igh');configure(p).appMaster='ecm';
  expect(applicationProject(p).entrypoints.master.fileId).toBe(ecmId);
  synchronizeBus(p,3,2000);expect(buildBusCatalog(masterProject(p,'ecm')).masterId).toBe(3);expect(buildBusCatalog(p).cycleUs).toBe(2000);
  const loaded=await openProject(await saveProject(p));expect(masterKinds(loaded)).toEqual(['igh','ecm']);
  selectMaster(loaded,'ecm');expect(loaded.entrypoints.master.eniFileId).toBe(eniId);expect(loaded.entrypoints.master.fileId).toBe(ecmId);
 });
 it('exports simulation-only dependencies and blocks missing model resources',()=>{
  const p=createProject('Simulation','igh');configure(p).enabled={bus:false,app:false,simulation:false};enableSimulation(p);
  p.files.push(makeFile('simulation/models/scene.xml','mjcf','<mujoco><worldbody><geom type="sphere" size=".1"/></worldbody></mujoco>'));
  expect(validateProject(p).filter(d=>d.severity==='error')).toEqual([]);
  expect(planRuntime(p).files.map(f=>f.path).sort()).toEqual(['ROCOS-DEPLOYMENT.txt','simulation/config.yaml','simulation/hardware_config.yaml','simulation/models/scene.xml']);
  fileById(p,p.files.find(f=>f.role==='mjcf')!.id)!.bytes=utf8.encode('<mujoco><asset><mesh file="missing.stl"/></asset></mujoco>');
  expect(validateProject(p).some(d=>d.code==='reference.missing')).toBe(true);
 });
 it('retains disabled drafts but does not export or validate them',()=>{
  const p=createExample('igh');configure(p).enabled.app=false;p.editor.buffers[p.entrypoints.app!]={text:'broken:',baseHash:'test'};
  expect(validateProject(p).some(d=>d.code==='editor.pending')).toBe(false);expect(configuration(p).enabled.app).toBe(false);
 });
});

it('includes both bus formats and preserves ENI bytes in runtime export',()=>{
 const p=createExample('ecm'),eni=fileById(p,p.entrypoints.master.eniFileId)!;
 configure(p).enabled.app=false;selectMaster(p,'igh');
 const template=createExample('igh');fileById(p,p.entrypoints.master.fileId)!.bytes=fileById(template,template.entrypoints.master.fileId)!.bytes;
 const plan=planRuntime(p);expect(plan.files.map(f=>f.path)).toEqual(expect.arrayContaining(['master/igh.yaml','master/ecm.yaml','master/eni.xml']));
 expect(plan.files.find(f=>f.path==='master/eni.xml')!.bytes).toEqual(eni.bytes);
});

it('keeps disabled ECM settings and ENI when re-enabled',()=>{
 const p=createExample('ecm'),eni=p.entrypoints.master.eniFileId;
 selectMaster(p,'igh');configure(p).disabledMasters=['ecm'];expect(masterKinds(p)).toEqual(['igh']);
 selectMaster(p,'ecm');expect(p.entrypoints.master.eniFileId).toBe(eni);expect(masterKinds(p)).toEqual(['igh','ecm']);
});

it.each([1,2,3,4,5,6,7])('tracks enabled runtime roots for module mask %i',mask=>{
 const p=createExample('igh');enableSimulation(p);configure(p).enabled={bus:!!(mask&1),app:!!(mask&2),simulation:!!(mask&4)};
 const active=activeFileIds(p);
 expect(active.has(p.entrypoints.master.fileId!)).toBe(!!(mask&1));expect(active.has(p.entrypoints.app!)).toBe(!!(mask&2));expect(active.has(configuration(p).simulationFileId!)).toBe(!!(mask&4));
});
