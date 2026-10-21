import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ighRules, ecmRules } from '../../src/core/project/profiles';

const sources={
  app:{root:process.env.ROCOS_APP_SOURCE,revision:'7093bcd',header:'src/shared_memory_config.hpp'},
  igh:{root:process.env.ROCOS_IGH_SOURCE,revision:'3c92f2a',header:'src/shared_memory_config.hpp'},
  ecm:{root:process.env.ROCOS_ECM_SOURCE,revision:'e0e5e32',header:'include/rocos_ecm/shared_memory_config.hpp'},
};
type Kind=keyof typeof sources;
const enabled=process.platform==='linux'&&Object.values(sources).every(source=>source.root);
const flags=['-O2','-Wall','-Wextra','-pedantic','-pthread'];
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

describe.skipIf(!enabled)('separately compiled original shared-memory headers (private file mappings; no controller IPC)',()=>{
  let directory:string;
  const executables={} as Record<Kind|'incompatible',string>;
  const layouts:Record<string,any>={},provenance:Record<string,unknown>={},passed:string[]=[];
  const children=new Set<ChildProcessWithoutNullStreams>();
  let compiler='',target='';
  const run=(executable:string,args:string[])=>spawnSync(executable,args,{encoding:'utf8',timeout:5000});
  beforeAll(()=>{
    directory=mkdtempSync(resolve(tmpdir(),'rocos-abi-'));
    compiler=execFileSync('g++',['--version'],{encoding:'utf8'}).trim();
    target=execFileSync('g++',['-dumpmachine'],{encoding:'utf8'}).trim();
    for(const [kind,source] of Object.entries(sources) as [Kind,typeof sources[Kind]][]){
      const revision=execFileSync('git',['-C',source.root!,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
      expect(revision.startsWith(source.revision)).toBe(true);
      expect(execFileSync('git',['-C',source.root!,'status','--porcelain','--',source.header,...(kind==='app'?['src/hardware.hpp','src/hardware.cpp']:[])],{encoding:'utf8'}).trim()).toBe('');
      const path=resolve(source.root!,source.header),headerHash=hash(readFileSync(path));
      executables[kind]=resolve(directory,kind);
      // The include path selects the original external header without copying or rewriting it.
      const compilation=[kind==='ecm'?'-std=c++11':'-std=c++17',...flags,'-I'+resolve(path,'..'),
        ...(kind==='app'?['-DROCOS_ABI_APP_HARDWARE','-ffunction-sections','-fdata-sections','-I'+resolve(source.root!,'3rdparty/spdlog/include'),'-I/usr/include/eigen3']:[]),
        'tests/consumer/abi-probe.cpp',...(kind==='app'?[resolve(source.root!,'src/hardware.cpp'),'-Wl,--gc-sections','-lyaml-cpp']:[]),'-o',executables[kind]];
      execFileSync('g++',compilation,{timeout:60000});
      if(kind==='app'){
        const symbols=execFileSync('nm',['-C',executables[kind]],{encoding:'utf8',maxBuffer:8*1024*1024});
        expect(symbols).toContain('rocos::Hardware::scanForEcatBus(');
        expect(symbols).not.toContain('rocos::Hardware::Hardware(');
        expect(symbols).not.toContain('rocos::Hardware::smWorkingThread(');
        expect(symbols).not.toMatch(/\b(shm_open|sem_open|shm_unlink)@/);
      }
      const result=run(executables[kind],['layout']);expect(result.status,result.stderr).toBe(0);
      layouts[kind]=JSON.parse(result.stdout);
      provenance[kind]={revision,header:source.header,sha256:headerHash,compilation, ...(kind==='app'?{hardwareSourceSha256:hash(readFileSync(resolve(source.root!,'src/hardware.cpp')))}:{})};
    }
    executables.incompatible=resolve(directory,'incompatible');
    execFileSync('g++',['-std=c++17',...flags,'-DMAX_PD_NAME_LEN=80','-I'+resolve(sources.app.root!,'src'),'tests/consumer/abi-probe.cpp','-o',executables.incompatible],{timeout:60000});
    layouts.incompatible=JSON.parse(execFileSync(executables.incompatible,['layout'],{encoding:'utf8'}));
  },65000);
  afterAll(async()=>{
    for(const child of children){if(child.exitCode===null&&child.signalCode===null){const closed=new Promise<void>(done=>child.once('close',()=>done()));child.kill('SIGKILL');await closed;}}
    mkdirSync('test-results/consumer-abi',{recursive:true});
    writeFileSync('test-results/consumer-abi/report.json',JSON.stringify({
      scope:'Original headers compiled independently; field layout and live MAP_SHARED file exchange. No named IPC lifecycle, actual controller binary, SDK or hardware validation.',
      status:passed.length===6?'passed':'incomplete',passed,compiler,target,platform:process.platform,architecture:process.arch,kernel:release(),flags,
      overrides:'Default header macros; incompatible control uses MAX_PD_NAME_LEN=80.',
      sources:provenance,probeSha256:hash(readFileSync('tests/consumer/abi-probe.cpp')),layouts,
    },null,2)+'\n');
    if(directory)rmSync(directory,{recursive:true,force:true});
  });
  async function producer(kind:Kind,path:string){
    const child=spawn(executables[kind],['serve',path]);children.add(child);
    let output='',errors='';child.stdout.on('data',data=>{output+=data.toString();});child.stderr.on('data',data=>{errors+=data.toString();});
    const closed=new Promise<{code:number|null;output:string;errors:string}>((done,reject)=>{
      child.once('error',reject);child.once('close',code=>{children.delete(child);done({code,output,errors});});
    });
    // Attach both branches immediately so a spawn failure cannot become an unhandled rejection.
    const ready=new Promise<void>((done,reject)=>{
      const timer=setTimeout(()=>reject(new Error('ABI producer did not become ready: '+errors)),5000);
      child.stdout.on('data',()=>{if(output.includes('READY\n')){clearTimeout(timer);done();}});
      void closed.then(result=>{clearTimeout(timer);reject(new Error('ABI producer exited before exchange: '+result.errors));},error=>{clearTimeout(timer);reject(error);});
    });
    await ready;
    return {finish:async(command:'verify'|'stop')=>{
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.stdin.end(command+'\n');
      try{return await closed;}finally{clearTimeout(timer);}
    }};
  }
  it.each(['igh','ecm'] as const)('%s and APP have matching default layouts and configurator capacity rules',kind=>{
    expect(layouts[kind]).toEqual(layouts.app);
    const rules=kind==='igh'?ighRules:ecmRules;
    expect(layouts[kind].constants).toMatchObject({MAX_SLAVE_NUM:rules.maxSlaves,MAX_PDINPUT_NUM:rules.variablesPerDirection,MAX_PDOUTPUT_NUM:rules.variablesPerDirection,MAX_PD_NAME_LEN:rules.variableNameBytes+1,MAX_SLAVE_NAME_LEN:rules.slaveNameBytes+1});
    expect(layouts[kind].structures.EcatBus.size).toBeLessThanOrEqual(layouts[kind].constants.EC_SHM_MAX_SIZE);
    passed.push(kind+':layout');
  });
  it.each(['igh','ecm'] as const)('%s producer observes APP control and PDO writes through its still-live mapping',async kind=>{
    expect(layouts[kind]).toEqual(layouts.app);
    const path=resolve(directory,kind+'.mapped'),server=await producer(kind,path);
    const response=run(executables.app,['exchange',path]);
    expect(response.status,response.stderr).toBe(0);expect(response.stdout).toBe('EXCHANGED\n');
    const result=await server.finish('verify');expect(result.code,result.errors).toBe(0);expect(result.output).toBe('READY\nVERIFIED\n');
    passed.push(kind+':exchange');
  });
  it('uses the original APP locator and exposes its requirement for input and output on the first slave',()=>{
    for(const [mode,expected] of [['scan-valid','LOCATED'],['scan-no-input','REJECTED'],['scan-no-output','REJECTED']]){
      const result=run(executables.app,[mode]);expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe(expected);
    }
    passed.push('app:original-locator');
  });
  it('detects a different capacity macro and rejects its access before mapping an incompatible fixture',async()=>{
    expect(layouts.incompatible.constants.MAX_PD_NAME_LEN).toBe(80);
    expect(layouts.incompatible.structures.PdVar).not.toEqual(layouts.app.structures.PdVar);
    const path=resolve(directory,'incompatible.mapped'),server=await producer('igh',path),before=hash(readFileSync(path));
    const result=run(executables.incompatible,['exchange',path]);
    expect(result.status).toBe(1);expect(result.stderr).toContain('ABI fixture size does not match this build');
    expect(hash(readFileSync(path))).toBe(before);
    const stopped=await server.finish('stop');expect(stopped.code,stopped.errors).toBe(0);
    passed.push('incompatible:rejected');
  });
});
