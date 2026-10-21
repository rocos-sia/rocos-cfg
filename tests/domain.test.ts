import { expect, it } from 'vitest';
import { createProject, makeFile } from '../src/core/project/create';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { readRobot, controlChain, editJoint } from '../src/core/documents/urdf';
import { xmlDocument } from '../src/core/documents/xml';
import { patchYaml } from '../src/core/documents/yaml';
import { textOf, utf8 } from '../src/core/project/types';
const urdf='<robot name="test"><link name="base"/><link name="tip"/><joint name="j" type="revolute"><parent link="base"/><child link="tip"/><limit lower="-1" upper="1" velocity="1" effort="1"/></joint><custom keep="yes"/></robot>';
it('edits URDF while preserving extension nodes and detects cycles',()=>{
  const result=editJoint(urdf,'j','xyz','1 0 0');expect(result).toContain('custom keep="yes"');expect(readRobot(result).joints[0].xyz).toBe('1 0 0');
  expect(controlChain(result,'base','tip').map(j=>j.name)).toEqual(['j']);
  expect(readRobot(editJoint(result,'j','parent','tip')).errors.join(' ')).toContain('环');
});
it('refuses external XML entities',()=>{expect(()=>xmlDocument('<!DOCTYPE robot SYSTEM "file:///etc/passwd"><robot/>')).toThrow('DTD');});
it('builds direction-correct IgH signals with bit widths retained',()=>{
  const p=createProject('io','igh'),f=p.files[0];
  f.bytes=utf8.encode(patchYaml(textOf(f),['slaves'],[{id:0,name:'IO',rx_pdos:[{index:0x1600,entries:[{name:'DO',index:0x7000,sub_index:1,bit_length:1}]}],tx_pdos:[{index:0x1a00,entries:[]}]}]));
  const c=buildBusCatalog(p);expect(c.signals[0]).toMatchObject({direction:'output',bitLength:1,storageBytes:1});expect(c.diagnostics.some(d=>d.code==='igh.discovery')).toBe(true);
});
it('reads ENI process image rather than all candidate PDO nodes',()=>{
  const p=createProject('ecm','ecm');const eni=makeFile('master/eni.xml','eni',`<EtherCATConfig Version="1.3"><Config><Slave><Info><Name>Drive</Name><PhysAddr>1001</PhysAddr></Info><ProcessData><Send><BitStart>0</BitStart><BitLength>16</BitLength></Send><Recv><BitStart>0</BitStart><BitLength>32</BitLength></Recv><TxPdo><Entry><Name>Unused</Name></Entry></TxPdo></ProcessData></Slave><ProcessImage><Inputs><ByteSize>4</ByteSize><Variable><Name>Drive.Inputs.Position</Name><DataType>DINT</DataType><BitSize>32</BitSize><BitOffs>0</BitOffs></Variable></Inputs><Outputs><ByteSize>2</ByteSize><Variable><Name>Drive.Outputs.Control</Name><DataType>UINT</DataType><BitSize>16</BitSize><BitOffs>0</BitOffs></Variable></Outputs></ProcessImage></Config></EtherCATConfig>`);
  p.files.push(eni);p.entrypoints.master.eniFileId=eni.id;
  const c=buildBusCatalog(p);expect(c.diagnostics).toEqual([]);expect(c.signals).toHaveLength(2);expect(c.signals[0]).toMatchObject({slaveId:0,runtimeName:'Position',resolution:'resolved'});
});
it('matches the seven-drive ENI ProcessImage sample including 56 inputs and 35 outputs',async()=>{
  const {readFile}=await import('node:fs/promises');
  const p=createProject('real-layout','ecm');const f=makeFile('master/eni.xml','eni',await readFile(new URL('./fixtures/eni-seven-drives.xml',import.meta.url),'utf8'));
  p.files.push(f);p.entrypoints.master.eniFileId=f.id;const c=buildBusCatalog(p);
  expect(c.slaves.map(s=>s.address)).toEqual([1001,1002,1003,1004,1005,1006,1007]);
  expect(c.signals.filter(s=>s.direction==='input')).toHaveLength(56);expect(c.signals.filter(s=>s.direction==='output')).toHaveLength(35);
  expect(c.signals.every(s=>s.resolution==='resolved')).toBe(true);expect(c.diagnostics).toEqual([]);
});
