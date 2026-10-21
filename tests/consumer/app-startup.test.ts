import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { appDocument } from '../../src/core/documents/app-config';
import { makeFile } from '../../src/core/project/create';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { resourceProject } from '../fixtures/resources';
import { planRuntime } from '../../src/core/export';
const source=process.env.ROCOS_APP_SOURCE;
describe.skipIf(!source)('APP 7093bcd original startup loader (no Robot construction)',()=>{
  let temporary:string,executable:string;
  beforeAll(()=>{
    expect(execFileSync('git',['-C',source!,'rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim()).toBe('7093bcd');
    expect(execFileSync('git',['-C',source!,'status','--porcelain','--','src'],{encoding:'utf8'}).trim()).toBe('');
    temporary=mkdtempSync(resolve(tmpdir(),'app-startup-'));executable=resolve(temporary,'loader');
    execFileSync('g++',['-std=c++17','-O0',...['src','3rdparty/spdlog/include','3rdparty/json','3rdparty/ruckig/include'].map(path=>'-I'+resolve(source!,path)),'-I/usr/include/eigen3',
      'tests/consumer/app-startup-loader.cpp','-lyaml-cpp','-pthread','-o',executable],{timeout:60000});
    expect(execFileSync('nm',['-C',executable],{encoding:'utf8',maxBuffer:8*1024*1024})).not.toContain('rocos::Robot::Robot(');
  },65000);
  afterAll(()=>{if(temporary)rmSync(temporary,{recursive:true,force:true});});
  const run=(input:string)=>{const path=resolve(temporary,'config.yaml');writeFileSync(path,input);return spawnSync(executable,[path],{encoding:'utf8',timeout:5000,cwd:'/tmp'});};
  const check=(input:string)=>{
    const native=run(input);let ours:ReturnType<typeof appDocument>|undefined;
    try{ours=appDocument(makeFile('config.yaml','app',input));}catch{}
    expect(native.status===0,native.stderr).toBe(!!ours&&!ours.diagnostics.length);
    return {native,ours};
  };
  it.each(['010','"0x10"','+12','"12"','2147483648','1.0','1e1','08','0o10','" 12"','"12 "','null','0','-1'])('agrees on integer %s',literal=>{
    const {native,ours}=check(`http_control_ttl_seconds: ${literal}`);
    if(native.status===0)expect(JSON.parse(native.stdout).http_control_ttl_seconds).toBe(ours!.data.http_control_ttl_seconds);
  });
  it.each(['{}','robot: {}','http_host: null','robot: {base_link: null}','scripts: null','http_host: 010','unknown: {kept: true}',
    '[]','robot: null','robot: []','http_host: []','http_host: ""','http_port: 0','http_port: 65536','robot: {ecat_id: -1}',
    'robot: {base_link: ""}','robot: {urdf: ""}','web_root: ""','scripts: []'])('matches startup field/default behavior: %s',input=>{check(input);});
  it('matches all default fields and resolves paths from the configuration directory, independently of cwd',()=>{
    const {native,ours}=check('{}'),data=structuredClone(ours!.data);
    for(const key of ['scripts','web_root'])data[key]=resolve(temporary,data[key]);
    for(const key of ['hardware_config','urdf','joint_binding','payload'])data.robot[key]=resolve(temporary,data.robot[key]);
    expect(JSON.parse(native.stdout)).toEqual(data);
  });
  it('preserves native values through form edits and relative-path runtime export, then loads a relocated package',()=>{
    const p=resourceProject(),f=fileById(p,p.entrypoints.app)!;
    f.bytes=utf8.encode(textOf(f).replace('http_port: 8080','http_port: *n').replace('http_host: 0.0.0.0','http_host: &n 010'));
    editProjectYaml(p,f.id,doc=>doc.setIn(['http_control_ttl_seconds'],600));
    const before=run(textOf(f));expect(before.status,before.stderr).toBe(0);expect(JSON.parse(before.stdout)).toMatchObject({http_host:'010',http_port:8,http_control_ttl_seconds:600});
    const files=planRuntime(p).files,location=resolve(temporary,'relocated/project');
    for(const out of files){const dest=resolve(location,out.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,out.bytes);}
    const emitted=files.find(out=>out.fileId===f.id)!;
    const native=spawnSync(executable,[resolve(location,emitted.path)],{encoding:'utf8',timeout:5000,cwd:'/tmp'});
    expect(native.status,native.stderr).toBe(0);expect(JSON.parse(native.stdout)).toMatchObject({http_host:'010',http_port:8,scripts:resolve(location,'scripts'),web_root:resolve(location,'web'),robot:{urdf:resolve(location,'models/robot.urdf'),hardware_config:resolve(location,'app/hardware_config.yaml')}});
  });
});
