import { fileById, textOf } from '../../src/core/project/types';
import { createExample } from '../../src/core/project/examples';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { controlChain, readRobot } from '../../src/core/documents/urdf';
const source=process.env.ROCOS_APP_SOURCE;
const joint=(name:string,type:string,parent:string,child:string,extra='')=>`<joint name="${name}" type="${type}"><parent link="${parent}"/><child link="${child}"/><axis xyz="0 0 1"/><limit lower="-1" upper="2" velocity="3" effort="4"/>${extra}</joint>`;
const model=(type='revolute',extra='')=>`<robot name="contract"><link name="base"/><link name="middle"/><link name="tip"/><link name="branch"/>${joint('second',type,'middle','tip',extra)}${joint('branch_joint','fixed','base','branch')}${joint('first','fixed','base','middle')}</robot>`;
describe.skipIf(!source)('APP 7093bcd original Model, URDF and KDL chain (no hardware)',()=>{
  let temporary:string,executable:string;
  beforeAll(()=>{
    expect(execFileSync('git',['-C',source!,'rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim()).toBe('7093bcd');
    expect(execFileSync('git',['-C',source!,'status','--porcelain','--','src','3rdparty/kdl_parser','3rdparty/trac_ik'],{encoding:'utf8'}).trim()).toBe('');
    temporary=mkdtempSync(resolve(tmpdir(),'model-contract-'));executable=resolve(temporary,'loader');
    execFileSync('g++',['-std=c++17','-O0',...['src','3rdparty/spdlog/include','3rdparty/json','3rdparty/kdl_parser/include','3rdparty/trac_ik/include'].map(path=>'-I'+resolve(source!,path)),'-I/usr/include/eigen3',
      'tests/consumer/model-loader.cpp',...['src/model.cpp','src/logger.cpp','3rdparty/kdl_parser/src/kdl_parser.cpp','3rdparty/trac_ik/src/kdl_tl.cpp','3rdparty/trac_ik/src/nlopt_ik.cpp','3rdparty/trac_ik/src/trac_ik.cpp'].map(path=>resolve(source!,path)),
      '-lurdfdom_model','-lconsole_bridge','-lorocos-kdl','-ltinyxml','-ltinyxml2','-lnlopt','-lboost_date_time','-lboost_system','-pthread','-o',executable],{timeout:120000});
  },125000);
  afterAll(()=>{if(temporary)rmSync(temporary,{recursive:true,force:true});});
  const run=(input:string,base='base',tip='tip')=>{
    const path=resolve(temporary,'robot.urdf');writeFileSync(path,input);
    const output=resolve(temporary,'result.json');rmSync(output,{force:true});
    const result=spawnSync(executable,[path,base,tip,output],{encoding:'utf8',timeout:5000,cwd:temporary});
    const json=existsSync(output)?readFileSync(output,'utf8'):undefined;
    return {...result,joints:json?JSON.parse(json):undefined};
  };
  it.each(['revolute','prismatic','continuous'])('matches control order for %s with fixed segments, branches and out-of-order XML',type=>{
    const input=model(type),result=run(input);expect(result.status,result.stderr).toBe(0);
    expect(result.joints.map((j:any)=>j.name)).toEqual(controlChain(input,'base','tip').map(j=>j.name));
    expect(result.joints).toEqual([{name:'second',lower:-1,upper:2,velocity:3,effort:4}]);
    expect(readRobot(input).joints.find(j=>j.name==='second')).toMatchObject({lower:'-1',upper:'2',velocity:'3',effort:'4'});
  });
  it('documents legacy consumer overrides while the configurator ignores the hardware extension',()=>{
    const input=model('revolute','<hardware><limit lower="-0.5" upper="0.75" vel="1.5" effort="6"/></hardware>'),result=run(input);
    expect(result.status,result.stderr).toBe(0);expect(result.joints).toEqual([{name:'second',lower:-0.5,upper:0.75,velocity:1.5,effort:6}]);
    expect(readRobot(input).joints.find(j=>j.name==='second')?.lower).toBe('-1');
    expect(readRobot(input).joints.find(j=>j.name==='second')).toMatchObject({lower:'-1',upper:'2',velocity:'3',effort:'4'});
  });
  it('records legacy APP defaults without injecting them into continuous joints',()=>{
    const input=model('continuous').replace('<limit lower="-1" upper="2" velocity="3" effort="4"/>',''),result=run(input);
    expect(result.status,result.stderr).toBe(0);
    expect(result.joints).toEqual([{name:'second',lower:-Math.PI,upper:Math.PI,velocity:null,effort:null}]);
    expect(controlChain(input,'base','tip')[0]).toMatchObject({lower:'',upper:'',velocity:'',effort:''});
  });
  it('rejects invalid URDF and missing chain endpoints',()=>{
    for(const input of [model().replace('name="contract"',''),model().replace('type="revolute"','type="unknown"'),model().replace('velocity="3"','velocity="bad"')])expect(run(input).status).not.toBe(0);
    expect(run(model(),'missing').status).not.toBe(0);
  });
  it('matches multi-joint order regardless of XML order',()=>{
    const input=model().replace('<link name="base"/>','<link name="mount"/><link name="base"/>').replace('</robot>',joint('shoulder','prismatic','mount','base')+'</robot>');
    const result=run(input,'mount','tip');expect(result.status,result.stderr).toBe(0);
    expect(result.joints.map((j:any)=>j.name)).toEqual(['shoulder','second']);
    expect(controlChain(input,'mount','tip').map(j=>j.name)).toEqual(['shoulder','second']);
  });
  it('matches the actual Talon seven-joint order while ignoring legacy hardware extensions',()=>{
    expect(execFileSync('git',['-C',source!,'status','--porcelain','--','models/talon/robot.urdf'],{encoding:'utf8'}).trim()).toBe('');
    const input=readFileSync(resolve(source!,'models/talon/robot.urdf'),'utf8'),result=run(input,'base_link','link_7');
    expect(result.status,result.stderr).toBe(0);
    const chain=controlChain(input,'base_link','link_7');expect(chain).toHaveLength(7);
    expect(result.joints.map((j:any)=>j.name)).toEqual(chain.map(j=>j.name));
    for(const j of chain)expect(j).toMatchObject({lower:'',upper:'',velocity:'',effort:''});
  });
  it.each(['floating','planar'])('reports %s as unsupported instead of silently treating it as fixed like KDL',type=>{
    const input=model(type).replace('name="first" type="fixed"','name="first" type="revolute"'),result=run(input);
    expect(result.status,result.stderr).toBe(0);expect(result.joints.map((j:any)=>j.name)).toEqual(['first']);
    expect(()=>controlChain(input,'base','tip')).toThrow('mimic/floating/planar');
  });
  it('keeps mimic unsupported in the configurator because the original Model treats it as an independent joint',()=>{
    const input=model('revolute','<mimic joint="other" multiplier="2"/>').replace('<link name="branch"/>','<link name="branch"/><link name="end"/>');
    // Put the mimic target on a separate branch; it is not a coupled DOF in Model.
    const complete=input.replace('</robot>',joint('other','revolute','branch','end')+'</robot>'),result=run(complete);
    expect(result.status,result.stderr).toBe(0);expect(result.joints.map((j:any)=>j.name)).toEqual(['second']);
    expect(()=>controlChain(complete,'base','tip')).toThrow('mimic');
  });
  it.each(['igh','ecm'] as const)('loads the %s teaching model and control chain',kind=>{
    const p=createExample(kind),result=run(textOf(fileById(p,p.entrypoints.urdf)!),'base_link','tool_link');
    expect(result.status,result.stderr).toBe(0);expect(result.joints).toEqual([{name:'joint_1',lower:-1,upper:1,velocity:1,effort:10}]);
  });
});
