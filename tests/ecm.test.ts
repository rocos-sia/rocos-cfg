import { expect, it } from 'vitest';
import { ecmDocument } from '../src/core/bus/ecm';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { createProject, makeFile } from '../src/core/project/create';
import { collectReferences } from '../src/core/project/references';
import { textOf, utf8 } from '../src/core/project/types';
import { modules } from '../src/core/modules';

it('reads native ECM scalars and defaults while reporting startup errors independently of missing ENI',()=>{
  const p=createProject('startup','ecm'),f=p.files[0];
  f.bytes=utf8.encode('id: 010\ncycle: "0x400"\nctloff: OFF\nstate: SAFEOP\nsp: null\nflash: 0');
  expect(ecmDocument(f)).toMatchObject({data:{id:8,cpuidx:8,cycle:1024,ctloff:false,state:'safeop',sp:null,flash:0},diagnostics:[]});
  const c=buildBusCatalog(p);expect(c.masterId).toBe(8);expect(c.cycleUs).toBe(1024);expect(c.diagnostics.map(d=>d.code)).toEqual(['eni.missing']);
  f.bytes=utf8.encode('duration: -1\nverbose: null\nctloff: TrUe\nstate: typo\nlicense: '+ '密'.repeat(22));
  expect(ecmDocument(f).diagnostics.map(d=>d.field)).toEqual(expect.arrayContaining(['duration','verbose','ctloff','state','license']));
  expect(buildBusCatalog(p).diagnostics.some(d=>d.code==='ecm.startup')).toBe(true);
});

it('preserves native values, comments and shared aliases when editing a different field or exporting paths',()=>{
  const p=createProject('startup','ecm'),f=p.files[0];
  f.bytes=utf8.encode('# keep\nid: &n 010\nlicense: *n\nctloff: ON\neni: vendor.xml\ncycle: 1e3\n');
  editProjectYaml(p,f.id,doc=>doc.setIn(['duration'],3000));
  expect(textOf(f)).toContain('# keep');expect(textOf(f)).toContain('*n');
  const before=ecmDocument(f);expect(before.data).toMatchObject({id:8,cpuidx:8,license:'010',ctloff:true,duration:3000});
  expect(before.diagnostics.map(d=>d.field)).toContain('cycle'); // do not silently repair invalid native numeric spelling
  const adapter=modules.get('ecm',1)!;
  const result=adapter.export(adapter.parse(f),{project:p,file:f,path:f.path,rewrites:[{field:'eni',value:'eni.xml'}]})[0];
  expect(ecmDocument({...f,bytes:result.bytes}).data).toEqual({...before.data,eni:'eni.xml'});
  expect(textOf(f)).toContain('vendor.xml');
});

it('collects the consumer default ENI dependency when eni is absent and rejects empty mappings',()=>{
  const p=createProject('startup','ecm'),f=p.files[0];f.bytes=utf8.encode('id: 0');
  const eni=makeFile('master/eni7.xml','eni','<EtherCATConfig/>');p.files.push(eni);p.entrypoints.master.eniFileId=eni.id;
  expect(collectReferences(p).find(r=>r.sourceFileId===f.id)).toMatchObject({original:'eni7.xml',targetFileId:eni.id,state:'internal'});
  expect(()=>ecmDocument({...f,bytes:utf8.encode('{}')})).toThrow('非空映射');
});
