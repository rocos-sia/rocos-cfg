import { verifySourceBaseline } from './source';
import { createExample } from '../../src/core/project/examples';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createProject, makeFile } from '../../src/core/project/create';
import { ecmDocument } from '../../src/core/bus/ecm';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { readYaml } from '../../src/core/documents/yaml';
import { fileById, textOf, utf8 } from '../../src/core/project/types';
import { modules } from '../../src/core/modules';
const source=process.env.ROCOS_ECM_SOURCE;
describe.skipIf(!source)('ECM e0e5e32 original startup loader (no SDK or hardware)',()=>{
  let temporary:string,executable:string;
  beforeAll(()=>{
    verifySourceBaseline(source!,'e0e5e32',['Main/Common/EcConfig.cpp','Main/Common/EcConfig.h']);
    temporary=mkdtempSync(resolve(tmpdir(),'ecm-'));executable=resolve(temporary,'loader');
    execFileSync('g++',['-std=c++17','-O0','-I'+resolve(source!,'Main/Common'),'tests/consumer/ecm-loader.cpp',resolve(source!,'Main/Common/EcConfig.cpp'),'-lyaml-cpp','-o',executable],{timeout:60000});
    writeFileSync(resolve(temporary,'eni7.xml'),'<EtherCATConfig/>');writeFileSync(resolve(temporary,'eni.xml'),'<EtherCATConfig/>');
  },65000);
  afterAll(()=>{if(temporary)rmSync(temporary,{recursive:true,force:true});});
  const run=(text:string)=>{const path=resolve(temporary,'ecm.yaml');writeFileSync(path,text);return spawnSync(executable,[path],{encoding:'utf8',timeout:5000});};
  const check=(input:string)=>{
    const native=run(input);let ours:ReturnType<typeof ecmDocument>|undefined;
    try{ours=ecmDocument(makeFile('ecm.yaml','ecm',input));}catch{}
    expect(native.status===0,native.stderr).toBe(!!ours&&!ours.diagnostics.length);
    return {native,ours};
  };
  it.each(['0','010','"0x10"','+12','"12"','2147483647','2147483648','1.0','1e1','08','0o10','" 12"','"12 "','null'])('agrees on native integer %s',literal=>{
    const {native,ours}=check(`id: ${literal}\ncpuidx: 0`);
    if(native.status===0)expect(Number(readYaml(native.stdout).id)).toBe(ours!.data.id);
  });
  it.each(['true','FALSE','Yes','ON','off','n','TrUe','1','null','[]'])('agrees on native boolean %s',literal=>{
    const {native,ours}=check(`ctloff: ${literal}`);
    if(native.status===0)expect(readYaml(native.stdout).ctloff).toBe(String(ours!.data.ctloff));
  });
  it.each(['{}','[]','state: typo','state: null','duration: -1','verbose: -1','auxclk: 1','cycle: 2147484','cycle: 0','id: 32','sp: 0','mbxsrv: 65536','flash: -1','eni: ""','eni: null','license: null','log: []','typo: 1','id: 0\nid: 1','license: "'+ '密'.repeat(22)+'"'])('rejects unsupported startup input %s',input=>{check(input);});
  it('matches defaults, derived CPU index and optional null/missing services',()=>{
    const {native,ours}=check('id: 3\nstate: SAFEOP\nsp: null\nflash: 0');
    const n=readYaml(native.stdout);expect(n).toMatchObject({id:'3',cpuidx:'3',state:'safeop',has_sp:'false',has_flash:'true',has_mbxsrv:'false',flash:'0'});
    expect(ours!.data).toMatchObject({cpuidx:3,state:'safeop',sp:null,flash:0,mbxsrv:null});
    expect(n.eni).toBe(resolve(temporary,'eni7.xml'));
  });
  it('keeps an octal anchor shared by integer and string fields through form edits and runtime path rewrites',()=>{
    const p=createProject('ecm','ecm'),f=p.files[0];f.bytes=utf8.encode('id: &n 010\nlicense: *n\neni: eni7.xml\nctloff: OFF\n');
    editProjectYaml(p,f.id,doc=>doc.setIn(['cycle'],2000));
    const edited=run(textOf(f));expect(edited.status,edited.stderr).toBe(0);
    expect(readYaml(edited.stdout)).toMatchObject({id:'8',cpuidx:'8',license:'010',ctloff:'false',cycle:'2000'});
    const adapter=modules.get('ecm',1)!;
    const outputs=adapter.export(adapter.parse(f),{project:p,file:f,path:'ecm.yaml',rewrites:[{field:'eni',value:'eni.xml'}]});
    const result=run(new TextDecoder().decode(outputs[0].bytes));expect(result.status,result.stderr).toBe(0);
    expect(readYaml(result.stdout)).toMatchObject({id:'8',license:'010',eni:resolve(temporary,'eni.xml')});
  });
  it('loads the bundled ECM teaching startup YAML without claiming SDK ENI validation',()=>{
    const p=createExample('ecm');writeFileSync(resolve(temporary,'eni.xml'),textOf(fileById(p,p.entrypoints.master.eniFileId)!));
    const result=run(textOf(fileById(p,p.entrypoints.master.fileId)!));expect(result.status,result.stderr).toBe(0);
  });
});
