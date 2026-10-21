import { expect, it } from 'vitest';
import { resourceProject } from './fixtures/resources';
import { createProject, makeFile } from '../src/core/project/create';
import { patchYaml } from '../src/core/documents/yaml';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { validateProject } from '../src/core/validation';
import { openProject, saveProject } from '../src/core/project/archive';
import { exportRuntime } from '../src/core/export';

function eniProject(input:boolean,output:boolean) {
  const p=createProject('locator','ecm');
  const area=(name:string,present:boolean)=>`<${name}><ByteSize>2</ByteSize>${present?`<Variable><Name>Drive.${name}.Value</Name><BitSize>16</BitSize><BitOffs>0</BitOffs></Variable>`:''}</${name}>`;
  const eni=makeFile('master/eni.xml','eni',`<EtherCATConfig Version="1.3"><Config><Slave><Info><Name>Drive</Name><PhysAddr>1001</PhysAddr></Info><ProcessData><Recv><BitStart>0</BitStart><BitLength>16</BitLength></Recv><Send><BitStart>0</BitStart><BitLength>16</BitLength></Send></ProcessData></Slave><ProcessImage>${area('Inputs',input)}${area('Outputs',output)}</ProcessImage></Config></EtherCATConfig>`);
  p.files.push(eni);p.entrypoints.master.eniFileId=eni.id;return p;
}
it.each([[false,true],[true,false],[false,false]])('blocks runtime export for known missing first-slave variables (%s, %s), preserving ENI in drafts',async(input,output)=>{
  const p=eniProject(input,output),eni=fileById(p,p.entrypoints.master.eniFileId)!;
  expect(buildBusCatalog(p).diagnostics).toEqual([]);
  expect(validateProject(p).filter(d=>d.code==='app.bus-location')).toMatchObject([{severity:'error',fileId:eni.id}]);
  expect(()=>exportRuntime(p)).toThrow();
  const restored=await openProject(await saveProject(p));
  expect(fileById(restored,eni.id)!.bytes).toEqual(eni.bytes);
  expect(validateProject(restored).some(d=>d.code==='app.bus-location')).toBe(true);
});
it('accepts known bidirectional first slaves in both adapters',()=>{
  for(const p of [resourceProject(),eniProject(true,true)])expect(validateProject(p).filter(d=>d.code.startsWith('app.bus-location'))).toEqual([]);
});
it('treats IgH discovery as unknown, not as proven zero variables',()=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.master.fileId)!;
  file.bytes=utf8.encode(patchYaml(textOf(file),['slaves',0,'tx_pdos',0,'entries'],[]));
  expect(buildBusCatalog(p).diagnostics.filter(d=>d.severity==='error')).toEqual([]);
  expect(validateProject(p).filter(d=>d.code.startsWith('app.bus-location'))).toMatchObject([{code:'app.bus-location.pending',severity:'warning'}]);
  p.targets.app.version='future';
  expect(validateProject(p).filter(d=>d.code.startsWith('app.bus-location'))).toEqual([]);
});
it('defers incomplete or invalid bus information to the existing parser diagnostics',()=>{
  const p=eniProject(false,true),eni=fileById(p,p.entrypoints.master.eniFileId)!;
  eni.bytes=utf8.encode(textOf(eni).replace('Drive.Outputs.Value','Unknown.Outputs.Value'));
  expect(validateProject(p).some(d=>d.code==='eni.association')).toBe(true);
  expect(validateProject(p).filter(d=>d.code.startsWith('app.bus-location'))).toEqual([]);
});
