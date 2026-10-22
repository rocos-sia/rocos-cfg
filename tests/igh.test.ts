import { describe, expect, it } from 'vitest';
import { createProject, makeFile } from '../src/core/project/create';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { buildIghCatalog, exactInteger } from '../src/core/bus/igh';
import { editProjectYaml, masterFileId, modifySequence, planSlaveChange, setInteger } from '../src/core/bus/igh-edit';
import { readYaml } from '../src/core/documents/yaml';
import { fileById, textOf, utf8 } from '../src/core/project/types';

export const minimal = `version: 1
slaves:
  - id: 0
    name: Drive
    rx_pdos: [{index: 0x1600, entries: []}]
    tx_pdos: [{index: 0x1a00, entries: []}]
`;
const errors = (text: string) => buildIghCatalog(makeFile('igh.yaml', 'igh', text)).diagnostics.filter(d => d.severity === 'error');

describe('IgH native configuration rules', () => {
  it('accepts omitted master defaults and all native empty-discovery forms', () => {
    for (const empty of ['[]', '{}', 'null', '']) expect(errors(minimal.replaceAll('entries: []}', `entries: ${empty}}`))).toEqual([]);
    expect(errors(minimal.replace('entries: []', 'wrong_entries: []'))).not.toEqual([]);
  });
  it('rejects lexical integer differences and unknown fields that yaml-cpp rejects', () => {
    for (const value of ['"1"', '+1', '1.0', '1e0', '!!int 1']) expect(errors(minimal.replace('version: 1', `version: ${value}`))).not.toEqual([]);
    expect(errors(minimal.replace('version: 1', 'version: 0X1'))).toEqual([]);
    expect(errors(minimal + 'unexpected: true\n').some(d => d.code === 'igh.unknown')).toBe(true);
    expect(errors(minimal.replace('id: 0', 'id: 1')).some(d => d.code === 'igh.slave-id')).toBe(true);
  });
  it('checks exact signed and unsigned boundaries, aliases and optional SDO name', () => {
    for (const type of ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']) {
      const bits = BigInt(type.replace(/\D/g, '')), unsigned = type.startsWith('u');
      const max = (1n << (unsigned ? bits : bits - 1n)) - 1n, min = unsigned ? 0n : -(1n << (bits - 1n));
      for (const value of [min, max]) {
        expect(exactInteger(String(value), type)).toBe(value);
        expect(errors(minimal + `    init_commands: [{index: 0x2000, sub_index: 0, Type: ${type}, Value: ${value}}]\n`)).toEqual([]);
      }
      expect(() => exactInteger(String(max + 1n), type)).toThrow('范围');
      expect(errors(minimal + `    init_commands: [{index: 0x2000, sub_index: 0, type: ${type}, value: ${max + 1n}}]\n`)).not.toEqual([]);
    }
    expect(errors(minimal + '    init_commands: [{index: 0x2000, sub_index: 0, Type: uint64, Value: "18446744073709551615"}]\n')).not.toEqual([]);
    expect(errors(minimal + '    init_commands: [{index: 0x2000, sub_index: 0, Type: uint8, type: uint8, Value: 1}]\n').some(d => d.code === 'igh.sdo-alias')).toBe(true);
  });
  it('checks DC limits, preserves bit PDO widths, and flags invalid entries as unresolved', () => {
    const base = minimal.replace('    name: Drive', '    name: Drive\n    dc_ref: true');
    expect(errors(base + 'master: {dc: on, period_us: 4294968}\n').some(d => d.code === 'igh.cycle')).toBe(true);
    const input = minimal.replace('entries: []', 'entries: [{name: Flag, index: 0x2000, sub_index: 0, bit_length: 1}]');
    const p = createProject('p', 'igh'); fileById(p, p.entrypoints.master.fileId)!.bytes = utf8.encode(input);
    expect(buildBusCatalog(p).signals[0]).toMatchObject({ bitLength: 1, storageBytes: 1, resolution: 'resolved' });
    fileById(p, p.entrypoints.master.fileId)!.bytes = utf8.encode(input.replace('bit_length: 1', 'bit_length: 0'));
    expect(buildBusCatalog(p).signals[0].resolution).toBe('unresolved');
  });
});

describe('IgH edits preserve document nodes and update references transactionally', () => {
  it('adds and reorders SDO commands without changing aliases, comments or 64-bit values', () => {
    const p = createProject('p', 'igh'), id = masterFileId(p);
    fileById(p, id)!.bytes = utf8.encode(minimal + '    # commissioning note\n    init_commands:\n      - {index: 0x2000, sub_index: 0, type: uint64, value: 18446744073709551615} # exact\n');
    editProjectYaml(p, id, doc => {
      modifySequence(doc, ['slaves', 0, 'init_commands'], 'add', 0, { index: 0x2001, sub_index: 1, Type: 'int64', Value: -9223372036854775808n });
      modifySequence(doc, ['slaves', 0, 'init_commands'], 'up', 1);
      setInteger(doc, ['slaves', 0, 'init_commands', 1, 'index'], 0x3000n, true);
    });
    const text = textOf(fileById(p, id)!);
    expect(text).toContain('# commissioning note'); expect(text).toContain('# exact');
    const commands = readYaml(text).slaves[0].init_commands;
    expect(commands[0].Value).toBe(-9223372036854775808n); expect(commands[1].value).toBe(18446744073709551615n);
    expect(commands[1].Type).toBeUndefined(); expect(commands[1].index).toBe(0x3000n);
  });
  it('moves, copies and removes physical slaves with hardware/binding impact and no mutation of the source project', () => {
    let p = createProject('p', 'igh');
    for (let i = 0; i < 3; i++) p = planSlaveChange(p, { kind: 'add' }).project;
    editProjectYaml(p, p.entrypoints.hardware!, doc => doc.setIn(['hardware'], [{ id: 0, type: 'driver', joint_name: 'joint_a' }, { id: 2, type: 'driver', joint_name: 'joint_b' }]));
    editProjectYaml(p, p.entrypoints.binding!, doc => doc.setIn(['joint_bindings'], [{ joint_name: 'joint_b', drive_id: 2 }, { joint_name: 'joint_a', drive_id: 0 }]));
    p.editor.confirmations = { 'drive:0': true, 'drive:2': true };
    const moved = planSlaveChange(p, { kind: 'up', index: 2 });
    expect(moved.impacts.join('\n')).toContain('Slave 2 → Slave 1');
    expect(readYaml(textOf(fileById(moved.project, p.entrypoints.hardware)!)).hardware.map((d: any) => d.id)).toEqual([0n, 1n]);
    expect(readYaml(textOf(fileById(moved.project, p.entrypoints.binding)!)).joint_bindings[0].drive_id).toBe(1n);
    expect(moved.project.editor.confirmations).toEqual({ 'drive:0': true });
    expect(readYaml(textOf(fileById(p, p.entrypoints.binding)!)).joint_bindings[0].drive_id).toBe(2n);
    const copied = planSlaveChange(moved.project, { kind: 'copy', index: 0 }).project;
    expect(readYaml(textOf(fileById(copied, masterFileId(copied))!)).slaves[1].dc_ref).toBe(false);
    expect(readYaml(textOf(fileById(copied, p.entrypoints.hardware)!)).hardware).toHaveLength(2);
    const removed = planSlaveChange(copied, { kind: 'delete', index: 2 }).project;
    expect(readYaml(textOf(fileById(removed, p.entrypoints.binding)!)).joint_bindings.map((b: any) => b.joint_name)).toEqual(['joint_a']);
  });
  it('refuses a structural transaction when an affected document has a pending source draft', () => {
    let p = createProject('p', 'igh'); p = planSlaveChange(p, { kind: 'add' }).project;
    p.editor.buffers[p.entrypoints.hardware!] = { text: 'hardware: [broken', baseHash: 'a'.repeat(64) };
    expect(() => planSlaveChange(p, { kind: 'delete', index: 0 })).toThrow('源码草稿');
    expect(readYaml(textOf(fileById(p, masterFileId(p))!)).slaves).toHaveLength(1);
  });
  it('moves a slave across multiple positions in one plan and remaps each dependent ID once', () => {
    let p = createProject('drag', 'igh');
    for (let i = 0; i < 4; i++) p = planSlaveChange(p, { kind: 'add' }).project;
    editProjectYaml(p, masterFileId(p), doc => { for (let i = 0; i < 4; i++) doc.setIn(['slaves', i, 'name'], `axis-${i}`); });
    editProjectYaml(p, p.entrypoints.hardware!, doc => doc.set('hardware', [{ id: 0, type: 'driver' }, { id: 3, type: 'driver' }]));
    editProjectYaml(p, p.entrypoints.binding!, doc => doc.set('joint_bindings', [{ joint_name: 'joint', drive_id: 0 }]));
    const moved = planSlaveChange(p, { kind: 'move', index: 0, target: 3 }).project;
    const slaves = readYaml(textOf(fileById(moved, masterFileId(moved))!)).slaves;
    expect(slaves.map((s: any) => s.name)).toEqual(['axis-1', 'axis-2', 'axis-3', 'axis-0']);
    expect(slaves.map((s: any) => s.id)).toEqual([0n, 1n, 2n, 3n]);
    expect(readYaml(textOf(fileById(moved, p.entrypoints.hardware)!)).hardware.map((d: any) => d.id)).toEqual([3n, 2n]);
    expect(readYaml(textOf(fileById(moved, p.entrypoints.binding)!)).joint_bindings[0].drive_id).toBe(3n);
    expect(() => planSlaveChange(p, { kind: 'move', index: 0, target: NaN })).toThrow();
  });
});
