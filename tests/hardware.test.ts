import { describe, expect, it } from 'vitest';
import { resourceProject } from './fixtures/resources';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { fileById, textOf, utf8, type Project } from '../src/core/project/types';
import { patchYaml, readYaml } from '../src/core/documents/yaml';
import { validateProject } from '../src/core/validation';
import { validateHardware } from '../src/core/hardware/validation';
import { bindingDocument, hardwareDocument } from '../src/core/hardware/schema';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { bindJoint, hardwareChain, invalidateHardwareConfirmation, legacyBindingSuggestion, planLegacyBinding, planHardware } from '../src/core/hardware/edit';
import { saveProject, openProject } from '../src/core/project/archive';
import { exportRuntime } from '../src/core/export';
const set=(p:Project,path:(string|number)[],value:unknown,id=p.entrypoints.hardware)=>{const f=fileById(p,id)!;f.bytes=utf8.encode(patchYaml(textOf(f),path,value));};
const codes=(p:Project)=>validateProject(p).filter(d=>d.severity==='error').map(d=>d.code);

describe('APP Hardware contract and mechanical configuration',()=>{
  it('requires a complete default-position mapping while allowing incomplete engineering archives',async()=>{
    const p=resourceProject();expect(codes(p)).toEqual([]);
    set(p,['hardware',0,'outputs'],{});
    expect(codes(p).filter(c=>c==='hardware.required')).toHaveLength(3);
    const restored=await openProject(await saveProject(p));
    expect(codes(restored)).toContain('hardware.required');expect(()=>exportRuntime(restored)).toThrow('错误');
  });
  it('handles malformed source shapes and explicit null values without crashing',()=>{
    for(const value of [null,{},'invalid',[null],[7],[{type:'driver',id:0,inputs:[],outputs:null,transform:null,limit:null}]]){
      const p=resourceProject();set(p,['hardware'],value);expect(()=>validateProject(p)).not.toThrow();expect(codes(p)).toContain('hardware.schema');
    }
    const p=resourceProject();set(p,['joint_bindings'],[null],p.entrypoints.binding);expect(codes(p)).toContain('binding.schema');
  });
  it('matches yaml-cpp int32 syntax including quoted hex and octal, rejects float integer tokens',()=>{
    const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
    for(const [literal,expected] of [['010',8],['"0x10"',16],['-010',-8],['2147483648',NaN],['1.0',NaN],['1e1',NaN],['08',NaN]] as const){
      f.bytes=utf8.encode(`hardware:\n  - type: io\n    id: ${literal}\n`);expect(hardwareDocument(f).devices[0].id).toBe(expected);
    }
  });
  it('checks signedness, complete storage width and exclusive output destinations',()=>{
    const p=resourceProject(),bus=buildBusCatalog(p),position=bus.signals.find(s=>s.runtimeName==='position_actual_value')!;
    position.dataType='REAL';expect(validateHardware(p,bus).map(d=>d.code)).toContain('hardware.datatype');
    position.dataType='DINT';position.bitLength=25;expect(validateHardware(p,bus).map(d=>d.code)).toContain('hardware.width');
    set(p,['hardware',0,'outputs','target_velocity'],'target_position');expect(codes(p)).toContain('hardware.shared-signal');
  });
  it('checks limits, transforms, integer overflow and parser defaults separately from human confirmation',()=>{
    const p=resourceProject();set(p,['hardware',0,'transform','ratio'],-1);expect(codes(p)).toEqual([]);
    set(p,['hardware',0,'transform','offset_pos_cnt'],1.5);expect(codes(p)).toContain('hardware.offset');
    set(p,['hardware',0,'transform','offset_pos_cnt'],0);set(p,['hardware',0,'transform','cnt_per_unit'],3e9);expect(codes(p)).toContain('hardware.overflow');
    set(p,['hardware',0,'limit','lower'],2);set(p,['hardware',0,'limit','acc'],0);expect(codes(p)).toContain('hardware.limit-order');expect(codes(p)).toContain('hardware.limit');
    set(p,['hardware',0,'torque_source'],'typo');expect(codes(p)).toContain('hardware.torque-source');
  });
  it('supports six-axis FT input offsets and reports unsupported outputs and multi-channel analog IO',()=>{
    const p=resourceProject();set(p,['hardware'],[{type:'ft_sensor',id:0,inputs:{},outputs:{fx:'ignored'},offset:{fx:null}}]);
    expect(codes(p).filter(c=>c==='hardware.required')).toHaveLength(6);expect(codes(p)).toContain('hardware.offset');
    expect(validateProject(p).some(d=>d.code==='hardware.ignored'&&d.field==='hardware.0.outputs')).toBe(true);
    set(p,['hardware'],[{type:'io',id:0,digital_out_channels:1,analog_in_channels:4}]);
    expect(codes(p)).toContain('hardware.channels');expect(codes(p).filter(c=>c==='hardware.required')).toHaveLength(3);
  });
  it('validates binding policy, unique driver IDs and URDF units, preserving differing limit values',()=>{
    const p=resourceProject();set(p,['binding_policy'],'ordered',p.entrypoints.binding);expect(codes(p)).toContain('binding.policy');
    set(p,['joint_bindings'],[{joint_name:'joint',drive_id:0},{joint_name:'joint',drive_id:0}],p.entrypoints.binding);expect(codes(p)).toContain('binding.name');expect(codes(p)).toContain('binding.invalid');
    set(p,['hardware',0,'transform','user_unit_name'],'degrees');expect(codes(p)).toContain('binding.unit');
    set(p,['hardware',0,'limit','upper'],0.5);expect(validateProject(p).some(d=>d.code==='binding.limit-difference'&&d.severity==='warning')).toBe(true);
  });
});
describe('Hardware editing and review ownership',()=>{
  it('creates a preview with explicit joint/slave choice, native PDO names, URDF limits and unknown mechanics',()=>{
    const p=resourceProject();set(p,['hardware'],[]);set(p,['joint_bindings'],[],p.entrypoints.binding);
    const plan=planHardware(p,{kind:'add',type:'driver',id:0,joint:'joint'}),d=hardwareDocument(fileById(plan.project,p.entrypoints.hardware)!).devices[0];
    expect(d.inputs.position_actual_value).toBe('position_actual_value');expect(d.outputs.mode_of_operation).toBe('mode_of_operation');
    expect(d.limit).toEqual({lower:-1,upper:1,vel:1,effort:10,acc:null,jerk:null});expect(d.transform.ratio).toBeNull();expect(Number.isNaN(d.transform.offset_pos_cnt)).toBe(true);
    expect(bindingDocument(fileById(plan.project,p.entrypoints.binding)!).bindings).toEqual([{joint_name:'joint',drive_id:0}]);
    expect(hardwareDocument(fileById(p,p.entrypoints.hardware)!).devices).toHaveLength(0);
    expect(()=>planHardware(p,{kind:'add',type:'driver',id:99})).toThrow('实际存在');
  });
  it('preserves YAML comments and extension fields through binding changes and atomic deletion',()=>{
    const p=resourceProject(),bf=fileById(p,p.entrypoints.binding)!;bf.bytes=utf8.encode('# binding notes\nbinding_policy: explicit\njoint_bindings:\n  - joint_name: joint # keep joint\n    drive_id: 0\n    extension: kept\n');
    bindJoint(p,'joint',0);expect(textOf(bf)).toContain('# keep joint');expect(textOf(bf)).toContain('extension: kept');
    const next=planHardware(p,{kind:'delete',index:0}).project;
    expect(hardwareDocument(fileById(next,p.entrypoints.hardware)!).devices).toHaveLength(0);
    expect(bindingDocument(fileById(next,p.entrypoints.binding)!).bindings).toHaveLength(0);
    p.editor.buffers[bf.id]={text:'draft',baseHash:'old'};
    expect(()=>planHardware(p,{kind:'delete',index:0})).toThrow('源码草稿');expect(hardwareDocument(fileById(p,p.entrypoints.hardware)!).devices).toHaveLength(1);
  });
  it('invalidates approvals for mechanics, chain, PDO and target changes, retaining unrelated edits',()=>{
    const p=resourceProject();
    for(const edit of [(n:Project)=>set(n,['hardware',0,'transform','ratio'],2),(n:Project)=>set(n,['robot','tip_link'],'different',n.entrypoints.app),(n:Project)=>{n.targets.app.version='future';}]){
      const n=structuredClone(p);edit(n);invalidateHardwareConfirmation(p,n);expect(n.editor.confirmations['drive:0']).toBeUndefined();
    }
    const n=structuredClone(p);set(n,['robot','payload'],'new.yaml',n.entrypoints.app);n.name='renamed';invalidateHardwareConfirmation(p,n);expect(n.editor.confirmations['drive:0']).toBe(true);
    expect(hardwareChain(p).map(j=>j.name)).toEqual(['joint']);
  });
});

it('preserves native octal values and nested aliases when changing an unrelated Hardware field',()=>{
  const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
  f.bytes=utf8.encode('hardware:\n - type: driver\n   id: 010\n   transform: &t {ratio: 1, offset_pos_cnt: 010}\n - type: driver\n   id: 2\n   transform: *t\n');
  expect(hardwareDocument(f).devices[1].transform.offset_pos_cnt).toBe(8);
  editProjectYaml(p,f.id,doc=>doc.setIn(['hardware',0,'joint_name'],'updated'));
  const ds=hardwareDocument(f).devices;
  expect(ds[0].id).toBe(8);expect(ds[0].transform.offset_pos_cnt).toBe(8);expect(ds[1].transform.offset_pos_cnt).toBe(8);expect(textOf(f)).toContain('*t');
});

it('previews missing-file fallback in YAML drive order and materializes explicit bindings without overwriting files',()=>{
  const p=resourceProject();p.entrypoints.binding=null;
  const suggestion=legacyBindingSuggestion(p);expect(suggestion).toEqual([{joint_name:'joint',drive_id:0}]);
  const plan=planLegacyBinding(p),bf=fileById(plan.project,plan.project.entrypoints.binding)!;
  expect(bf.path).toBe('app/joint_binding-1.yaml');
  expect(bindingDocument(bf).bindings).toEqual(suggestion);
  expect(readYaml(textOf(fileById(plan.project,plan.project.entrypoints.app)!)).robot.joint_binding).toBe('joint_binding-1.yaml');
  expect(p.entrypoints.binding).toBeNull();
  set(p,['hardware'],[{type:'driver',id:4},{type:'driver',id:1}]);
  const urdf=fileById(p,p.entrypoints.urdf)!;
  urdf.bytes=utf8.encode(textOf(urdf).replace('</robot>','<link name="end"/><joint name="joint2" type="revolute"><parent link="tip"/><child link="end"/><limit lower="-1" upper="1" effort="10" velocity="1"/></joint></robot>'));
  set(p,['robot','tip_link'],'end',p.entrypoints.app);
  expect(legacyBindingSuggestion(p)).toEqual([{joint_name:'joint',drive_id:4},{joint_name:'joint2',drive_id:1}]);
});
it('syncs a changed non-contiguous drive ID into binding while retaining native PDO names',()=>{
  const p=resourceProject(),master=fileById(p,p.entrypoints.master.fileId)!;
  const data=readYaml(textOf(master));
  set(p,['slaves'],[...data.slaves,...[1,2,3,4].map(id=>({...data.slaves[0],id,name:'Drive'+id}))],master.id);
  const plan=planHardware(p,{kind:'id',index:0,id:4});
  expect(hardwareDocument(fileById(plan.project,p.entrypoints.hardware)!).devices[0].inputs.status_word).toBe('status_word');
  expect(bindingDocument(fileById(plan.project,p.entrypoints.binding)!).bindings[0].drive_id).toBe(4);
});

it('keeps invalid native numeric literals invalid through unrelated form edits',()=>{
  const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
  f.bytes=utf8.encode('hardware: [{type: driver, id: 1.0, transform: {ratio: 0o10, cnt_per_unit: " 10", offset_pos_cnt: 1.0}}]');
  editProjectYaml(p,f.id,doc=>doc.setIn(['hardware',0,'joint_name'],'renamed'));
  const d=hardwareDocument(f).devices[0];expect(d.id).toBeNaN();expect(d.transform.ratio).toBeNaN();expect(d.transform.cnt_per_unit).toBeNaN();expect(d.transform.offset_pos_cnt).toBeNaN();
});

it('preserves shared scalar aliases with different native integer and floating point interpretations',()=>{
  const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
  f.bytes=utf8.encode('hardware: [{type: driver, id: 0, transform: {ratio: &n 010, offset_pos_cnt: *n}}]');
  editProjectYaml(p,f.id,doc=>doc.setIn(['hardware',0,'joint_name'],'edited'));
  const d=hardwareDocument(f).devices[0];expect(d.transform.ratio).toBe(10);expect(d.transform.offset_pos_cnt).toBe(8);
});
