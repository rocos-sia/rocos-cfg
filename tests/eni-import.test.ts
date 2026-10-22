import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { eniToIgh, planEniImport } from '../src/core/bus/eni-import';
import { createProject } from '../src/core/project/create';
import { masterProject } from '../src/core/project/configuration';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { readYaml } from '../src/core/documents/yaml';
const fixture=()=>readFile(new URL('../public/examples/talon/ecm/eni7.xml',import.meta.url));

it('converts only assigned PDOs in ENI order, including padding and startup SDOs',async()=>{
 const converted=eniToIgh(await fixture());
 expect(converted.slaves).toHaveLength(7);
 expect(converted.slaves.filter(s=>s.dc_ref).map(s=>s.id)).toEqual([0]);
 expect(converted.slaves[0].rx_pdos.map(p=>p.index)).toEqual([0x1602,0x160b,0x160f,0x161c]);
 expect(converted.slaves[0].tx_pdos.map(p=>p.index)).toEqual([0x1a02,0x1a11,0x1a1d,0x1a1e,0x1a1f]);
 expect(converted.slaves[0].tx_pdos[0].entries.at(-1)).toMatchObject({index:0,sub_index:0,bit_length:8});
 expect(converted.slaves[0].init_commands).toContainEqual({index:0x6060,sub_index:0,type:'uint8',value:8n});
});
it('updates both masters atomically and preserves original ENI bytes and hardware',async()=>{
 const base=createProject('test','igh'),before=structuredClone(base),bytes=await fixture();
 const {project,overwrite}=planEniImport(base,bytes);expect(overwrite).toBe(false);expect(base).toEqual(before);
 const ecm=masterProject(project,'ecm'),igh=masterProject(project,'igh');
 expect(buildBusCatalog(ecm).diagnostics).toEqual([]);expect(buildBusCatalog(ecm).signals).toHaveLength(91);
 expect(buildBusCatalog(igh).diagnostics).toEqual([]);expect(buildBusCatalog(igh).slaves).toHaveLength(7);
 expect(fileById(ecm,ecm.entrypoints.master.eniFileId)!.bytes).toEqual(new Uint8Array(bytes));
 expect(fileById(project,project.entrypoints.hardware)!.bytes).toEqual(fileById(base,base.entrypoints.hardware)!.bytes);
 expect(readYaml(textOf(fileById(ecm,ecm.entrypoints.master.fileId)!)).cycle).toBe(1000n);
 expect(planEniImport(project,bytes).overwrite).toBe(true);
});
it('requires confirmation for existing PDOs and drafts; rejects ambiguous ENI without modifying project',async()=>{
 const base=createProject('test','igh',{pdoTemplate:'drive-talon'}),before=structuredClone(base);
 expect(planEniImport(base,await fixture()).overwrite).toBe(true);
 const invalid=utf8.encode(new TextDecoder().decode(await fixture()).replace('<Pdo>5634</Pdo>','<Pdo>65535</Pdo>'));
 expect(()=>planEniImport(base,invalid)).toThrow('PDO');expect(base).toEqual(before);
 const blank=createProject('draft','igh');blank.editor.buffers[blank.entrypoints.master.fileId!]={text:'draft',baseHash:'x'};
 expect(planEniImport(blank,await fixture()).overwrite).toBe(true);
});

it('preserves an ECM-only project ID and vendor settings when creating IGH',async()=>{
 const base=createProject('ecm','ecm'),file=fileById(base,base.entrypoints.master.fileId)!;
 file.bytes=utf8.encode('id: 12\neni: eni.xml\ncycle: 2000\nlicense: keep-me\n');
 const {project,overwrite}=planEniImport(base,await fixture());expect(overwrite).toBe(false);
 expect(project.entrypoints.master.kind).toBe('ecm');expect(buildBusCatalog(project).masterId).toBe(12);
 expect(readYaml(textOf(fileById(project,project.entrypoints.master.fileId)!)).license).toBe('keep-me');
 expect(buildBusCatalog(masterProject(project,'igh')).masterId).toBe(12);
});
