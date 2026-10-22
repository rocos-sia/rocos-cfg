import { expect, it } from 'vitest';
import { diagnosticLocation, diagnosticSourceRange } from '../src/core/diagnostics/location';
import { createExample } from '../src/core/project/examples';
import { fileById, textOf, utf8, type Diagnostic } from '../src/core/project/types';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { validateProject } from '../src/core/validation';
const diagnostic=(fileId:string|undefined,field?:string,code='test'):Diagnostic=>({fileId,field,code,severity:'error',message:'test'});
it('selects hardware by document index, uses source for unsupported fields and never guesses a missing file',()=>{
  const p=createExample('igh'),id=p.entrypoints.hardware!;
  expect(diagnosticLocation(p,diagnostic(id,'hardware.0.inputs.status_word'))).toMatchObject({mode:'field',route:'hardware',index:0});
  expect(diagnosticLocation(p,diagnostic(id,'hardware.0','hardware.confirmation'))).toMatchObject({mode:'field',index:0});
  for(const field of ['hardware.0.type','hardware.5.inputs.status_word','hardware.0.transform.future'])expect(diagnosticLocation(p,diagnostic(id,field))?.mode).toBe('source');
  expect(diagnosticLocation(p,diagnostic('missing'))).toBeUndefined();expect(diagnosticLocation(p,diagnostic(undefined))).toBeUndefined();
});
it('routes startup and PDO fields to their actual forms and references to mapping controls',()=>{
  const p=createExample('igh'),id=p.entrypoints.master.fileId!;
  expect(diagnosticLocation(p,diagnostic(id,'master.period_us'))).toMatchObject({mode:'field',route:'master'});
  expect(diagnosticLocation(p,diagnostic(id,'slaves.0.rx_pdos.0.entries.0.bit_length'))).toMatchObject({mode:'field',index:0});
  expect(diagnosticLocation(p,diagnostic(id,'slaves.0.rx_pdos.4.index'))?.mode).toBe('source');
  expect(diagnosticLocation(p,diagnostic(p.entrypoints.app!,'robot.ecat_id'))).toMatchObject({mode:'field',route:'app'});
  expect(diagnosticLocation(p,diagnostic(p.entrypoints.app!,'robot.urdf','reference.missing'))).toMatchObject({mode:'resource',route:'app'});
});
it('prefers an existing draft and malformed documents over form navigation',()=>{
  const p=createExample('ecm'),id=p.entrypoints.master.fileId!;
  p.editor.buffers[id]={text:'cycle: [',baseHash:'retained'};
  expect(diagnosticLocation(p,diagnostic(id,'cycle'))?.mode).toBe('source');
  delete p.editor.buffers[id];fileById(p,id)!.bytes=utf8.encode('cycle: [');
  expect(diagnosticLocation(p,diagnostic(id,'cycle'))?.mode).toBe('source');
});
it('locates repeated YAML keys structurally and stops at alias references or the nearest existing parent',()=>{
  const text='# ratio: decoy\nhardware:\n  - transform:\n      ratio: 1\n  - transform:\n      ratio: 99\n';
  const range=diagnosticSourceRange(text,'yaml','hardware.1.transform.ratio');
  expect(text.slice(range.from,range.to)).toBe('99');expect(range.exact).toBe(true);
  const alias='base: &base\n  ratio: 1\nvalue: *base\n';const target=diagnosticSourceRange(alias,'yaml','value.ratio');
  expect(alias.slice(target.from,target.to)).toBe('*base');expect(target.exact).toBe(false);
  const missing=diagnosticSourceRange(text,'yaml','hardware.1.transform.missing');expect(text.slice(missing.from,missing.to)).toBe('transform');expect(missing.exact).toBe(false);
});
it('locates YAML parse errors without discarding the invalid buffer',()=>{
  const text='value: [broken';const range=diagnosticSourceRange(text,'yaml');
  expect(range.from).toBeGreaterThan(0);expect(range.to).toBeLessThanOrEqual(text.length);expect(range.exact).toBe(false);
});
it('locates XML occurrences despite comments, namespaces, repeated siblings and CRLF',()=>{
  const text="<e:EtherCATConfig xmlns:e='urn:test'>\r\n<!-- <Variable/> -->\r\n<Config><ProcessImage><Inputs><Variable/><Variable><Name>x</Name></Variable></Inputs></ProcessImage></Config></e:EtherCATConfig>";
  const r=diagnosticSourceRange(text,'xml','Config.ProcessImage.Inputs.Variable.1.Name');expect(text.slice(r.from,r.to)).toBe('<Name');expect(r.exact).toBe(true);
  const joint='<robot><hardware><joint/></hardware><joint/><joint name="second"/></robot>',j=diagnosticSourceRange(joint,'xml','joint.1');expect(joint.slice(j.from).startsWith('<joint name="second"')).toBe(true);
});
it('retains ECM startup field paths and points ENI diagnostics at the ENI rather than startup YAML',()=>{
  const p=createExample('ecm'),master=p.entrypoints.master.fileId!,eni=fileById(p,p.entrypoints.master.eniFileId)!;
  editProjectYaml(p,master,doc=>doc.set('cycle',0));eni.bytes=utf8.encode(textOf(eni).replace('<PhysAddr>1001</PhysAddr>','<PhysAddr>9999</PhysAddr>'));
  const catalog=buildBusCatalog(p);
  expect(catalog.diagnostics.find(d=>d.code==='ecm.startup')).toMatchObject({fileId:master,field:'cycle'});
  expect(catalog.diagnostics.find(d=>d.code==='ecm.address')).toMatchObject({fileId:eni.id,field:'Config.Slave.0.Info.PhysAddr'});
  const signal=catalog.signals[0];expect(signal.source).toEqual({fileId:eni.id,field:'Config.ProcessImage.Inputs.Variable.0'});
});
it('attaches standard URDF joint occurrences while ignoring opaque hardware',()=>{
  const p=createExample('igh'),urdf=fileById(p,p.entrypoints.urdf)!;
  urdf.bytes=utf8.encode(textOf(urdf).replace('<axis xyz="0 0 1"/>','<axis xyz="0 0 0"/>'));
  const diagnostics=validateProject(p).filter(d=>d.code==='urdf.structure');expect(diagnostics.some(d=>d.field==='joint.0')).toBe(true);
});
