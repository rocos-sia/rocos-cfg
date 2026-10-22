import { expect, it } from 'vitest';
import { createProject } from '../src/core/project/create';
import { devicePresets, deviceTemplate, validateTemplates, type DevicePreset } from '../src/core/project/templates';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { planSlaveChange } from '../src/core/bus/igh-edit';
import { openProject, saveProject } from '../src/core/project/archive';
import { fileById, textOf } from '../src/core/project/types';
import { readYaml } from '../src/core/documents/yaml';

const config = (p: ReturnType<typeof createProject>) => readYaml(textOf(fileById(p, p.entrypoints.master.fileId)!));
it('keeps blank projects blank and rejects device templates for read-only ECM PDOs', () => {
  expect(config(createProject('blank', 'igh', { pdoTemplate: 'blank' })).slaves).toEqual([]);
  expect(() => createProject('ecm', 'ecm', { pdoTemplate: 'ft-xjc' })).toThrow('ENI');
});
for (const preset of Object.keys(devicePresets) as Exclude<DevicePreset, 'blank'>[]) it(`${preset} creates and appends editable PDOs with durable model-specific snapshots`, async () => {
  const p = createProject('template', 'igh', { pdoTemplate: preset });
  const template = deviceTemplate(preset), slave = config(p).slaves[0];
  expect(slave).toMatchObject({ id: 0n, name: template.defaults.name, dc_ref: true });
  expect(buildBusCatalog(p).diagnostics).toEqual([]);
  expect(config(p).slaves).toHaveLength(1);
  const next = planSlaveChange(p, { kind: 'add', preset }).project;
  expect(config(next).slaves[1].dc_ref).toBe(false); expect(config(next).slaves).toHaveLength(2); expect(config(next).slaves[1].id).toBe(1n);
  expect(config(p).slaves).toHaveLength(1);
  expect(readYaml(textOf(fileById(next, next.entrypoints.hardware)!)).hardware).toEqual([]);
  expect(next.editor.confirmations).toEqual({});
  expect(validateTemplates(next)).toEqual([]);
  const restored = await openProject(await saveProject(next));
  expect(config(restored)).toEqual(config(next)); expect(validateTemplates(restored)).toEqual([]);
  const uses = restored.editor.templateUses!.filter(use => use.templateId === template.id);
  expect(uses).toHaveLength(2);
  expect(JSON.parse(textOf(fileById(restored, uses[0].snapshotFileId)!))).toEqual(template);
});
it('retains vendor-specific PDO indexes, padding and bit widths instead of adapting them to APP bindings', () => {
  const drive = deviceTemplate('drive-talon').data;
  expect(drive.rx_pdos[0].index).toBe(0x1607); expect(drive.tx_pdos[0].index).toBe(0x1a07);
  expect(drive.tx_pdos[0].entries.at(-1)).toEqual({name:'Load Torque Value',index:0x20a0,sub_index:0,bit_length:32});
  const ft = deviceTemplate('ft-xjc').data;
  expect(ft.rx_pdos[0].entries).toHaveLength(6); expect(ft.tx_pdos[0].entries).toHaveLength(13);
  expect(ft.tx_pdos[0].entries.slice(0, 8).map(e => e.bit_length)).toEqual(Array(8).fill(32));
  expect(ft.tx_pdos[0].entries.filter(e => e.index === 0)).toEqual([
    {name:'None_1',index:0,sub_index:0,bit_length:8}, {name:'None_2',index:0,sub_index:0,bit_length:8},
  ]);
  const io = deviceTemplate('io-ax58200').data;
  for (const [pdos, prefix, index] of [[io.rx_pdos,'RxPDO_1600',0x7000],[io.tx_pdos,'TxPDO_1A00',0x6000]] as const) {
    expect(pdos[0].entries).toEqual(Array.from({length:16},(_,i)=>({name:`${prefix}_${String(i+1).padStart(2,'0')}`,index,sub_index:i+1,bit_length:1})));
  }
});
