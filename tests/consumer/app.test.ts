import { createExample } from '../../src/core/project/examples';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { readYaml } from '../../src/core/documents/yaml';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { hardwareDocument } from '../../src/core/hardware/schema';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { resourceProject } from '../fixtures/resources';
import { planRuntime } from '../../src/core/export';
const source=process.env.ROCOS_APP_SOURCE;
describe.skipIf(!source)('APP 7093bcd original Hardware/JointBinding parsing (no hardware)',()=>{
  let temporary:string,executable:string;
  beforeAll(()=>{
    expect(execFileSync('git',['-C',source!,'rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim()).toBe('7093bcd');
    expect(execFileSync('git',['-C',source!,'status','--porcelain','--','src'],{encoding:'utf8'}).trim()).toBe('');
    temporary=mkdtempSync(resolve(tmpdir(),'rocos-app-contract-'));executable=resolve(temporary,'app-loader');
    execFileSync('g++',['-std=c++17','-O0','-ffunction-sections','-fdata-sections','-I'+resolve(source!,'src'),'-I'+resolve(source!,'3rdparty/spdlog/include'),'-I/usr/include/eigen3',
      'tests/consumer/app-loader.cpp',resolve(source!,'src/hardware.cpp'),resolve(source!,'src/joint_binding.cpp'),'-Wl,--gc-sections','-lyaml-cpp','-pthread','-o',executable],{timeout:90000});
    // Ensure dead-section elimination actually removed constructor and live bus functions.
    const symbols=execFileSync('nm',['-C',executable],{encoding:'utf8',maxBuffer:8*1024*1024});
    expect(symbols).not.toContain('rocos::Hardware::Hardware(');
    expect(symbols).not.toContain('rocos::Hardware::smWorkingThread(');
  },100000);
  afterAll(()=>{if(temporary)rmSync(temporary,{recursive:true,force:true});});
  const run=(hardware:string,binding?:string,names:string[]=[])=>{
    const file=resolve(temporary,'hardware.yaml');writeFileSync(file,hardware);
    const args=[file];if(binding!==undefined){const path=resolve(temporary,'binding.yaml');writeFileSync(path,binding);args.push(path,...names);}
    return spawnSync(executable,args,{encoding:'utf8',timeout:5000});
  };
  it.each(['0','010','-010','"0x10"','+12','"12"','-2147483648','2147483647','2147483648','1.0','1e1','08','" 12"','"12 "'])('agrees on native integer token %s',literal=>{
    const input=`hardware: [{type: driver, id: ${literal}}]`;
    const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;f.bytes=utf8.encode(input);
    const id=hardwareDocument(f).devices[0].id,native=run(input);
    expect(native.status===0,native.stderr).toBe(Number.isInteger(id));
    if(Number.isInteger(id))expect(Number(readYaml(native.stdout).drives[0].id)).toBe(id);
  });
  it('retains native octal and aliased zero offsets after a form edit',()=>{
    const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
    f.bytes=utf8.encode('hardware: [{type: driver, id: 010, transform: &t {offset_pos_cnt: 010}}, {type: driver, id: 2, transform: *t}]');
    editProjectYaml(p,f.id,doc=>doc.setIn(['hardware',0,'joint_name'],'edited'));
    const native=run(new TextDecoder().decode(f.bytes));expect(native.status,native.stderr).toBe(0);
    const data=readYaml(native.stdout);expect(data.drives[0].id).toBe(8n);expect(data.drives[0].offset).toBe(8n);expect(data.drives[1].offset).toBe(8n);
  });
  it.each(['010','"1.25"','1e2','0o10','0x10','" 1.5"','"1.5 "'])('agrees on native finite double token %s',literal=>{
    const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;f.bytes=utf8.encode(`hardware: [{type: driver, id: 0, transform: {ratio: ${literal}}}]`);
    const native=run(new TextDecoder().decode(f.bytes)),ratio=hardwareDocument(f).devices[0].transform.ratio;
    expect(native.status===0,native.stderr).toBe(Number.isFinite(ratio));
    if(Number.isFinite(ratio))expect(Number(readYaml(native.stdout).drives[0].ratio)).toBe(ratio);
  });
  it('preserves an alias used as both an integer offset and a floating point scale',()=>{
    const p=resourceProject(),f=fileById(p,p.entrypoints.hardware)!;
    f.bytes=utf8.encode('hardware: [{type: driver, id: 0, transform: {ratio: &n 010, offset_pos_cnt: *n}}]');
    editProjectYaml(p,f.id,doc=>doc.setIn(['hardware',0,'joint_name'],'edited'));
    const native=run(new TextDecoder().decode(f.bytes));expect(native.status,native.stderr).toBe(0);
    const d=readYaml(native.stdout).drives[0];expect(d.ratio).toBe(10n);expect(d.offset).toBe(8n);
  });
  it('shows native defaults and ignored keys separately from configurator completeness requirements',()=>{
    const result=run('hardware: [{type: driver, id: 4, torque_source: typo, secondary_velocity_value: ignored}]');
    expect(result.status,result.stderr).toBe(0);
    const d=readYaml(result.stdout).drives[0];expect(d.joint_name).toBe('joint_4');expect(d.ratio).toBe(1n);expect(d.lower).toBe(-2.71);expect(d.torque_source).toBe('load_torque');expect(d.status_word).toBe('');
    expect(run('hardware: [{type: driver, id: 0, transform: {ratio: null}}]').status).not.toBe(0);
  });
  it('reads FT offsets and IO feedback fields with the original parser',()=>{
    const result=run('hardware:\n - {type: ft_sensor, id: 2, inputs: {fx: ForceX}, offset: {fx: 1.5, tz: -2}}\n - {type: io, id: 3, digital_in_channels: 16, analog_out_channels: 4, inputs: {digital_outputs: Feedback}, outputs: {digital_outputs: Command}}\n');
    expect(result.status,result.stderr).toBe(0);const data=readYaml(result.stdout);
    expect(data.ft[0]).toEqual({id:2n,fx:'ForceX',offset_fx:1.5,offset_tz:-2n});expect(data.io[0]).toEqual({id:3n,di:16n,ao:4n,do_feedback:'Feedback',do_output:'Command'});
  });
  it('loads the emitted runtime hardware and binding files',()=>{
    const p=resourceProject(),files=planRuntime(p).files;
    const hw=files.find(f=>f.fileId===p.entrypoints.hardware)!,binding=files.find(f=>f.fileId===p.entrypoints.binding)!;
    const result=run(new TextDecoder().decode(hw.bytes),new TextDecoder().decode(binding.bytes),['joint']);
    expect(result.status,result.stderr).toBe(0);const data=readYaml(result.stdout);
    expect(data.bindings).toEqual([0n]);expect(data.drives[0].count).toBe(10000n);expect(data.drives[0].target_position).toBe('target_position');
  });
  it('preserves model order with non-contiguous driver IDs and rejects duplicate or unsupported bindings',()=>{
    const hw='hardware: [{type: driver, id: 4}, {type: driver, id: 1}]';
    const binding='binding_policy: explicit\njoint_bindings: [{joint_name: j2, drive_id: 4}, {joint_name: j1, drive_id: 1}]';
    const result=run(hw,binding,['j1','j2']);expect(result.status,result.stderr).toBe(0);expect(readYaml(result.stdout).bindings).toEqual([1n,4n]);
    expect(run(hw,binding.replace('drive_id: 1','drive_id: 4'),['j1','j2']).status).toBe(3);
    expect(run(hw,binding.replace('explicit','ordered'),['j1','j2']).status).toBe(3);
  });
  it.each(['igh','ecm'] as const)('loads the %s teaching hardware and explicit binding',kind=>{
    const p=createExample(kind),result=run(textOf(fileById(p,p.entrypoints.hardware)!),textOf(fileById(p,p.entrypoints.binding)!),['joint_1']);
    expect(result.status,result.stderr).toBe(0);expect(readYaml(result.stdout).drives[0].id).toBe(0n);
  });
});
