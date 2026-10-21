import { createExample } from '../../src/core/project/examples';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeFile, createProject } from '../../src/core/project/create';
import { buildIghCatalog } from '../../src/core/bus/igh';
import { editProjectYaml, masterFileId, planSlaveChange, modifySequence } from '../../src/core/bus/igh-edit';
import { fileById, textOf } from '../../src/core/project/types';

const source = process.env.ROCOS_IGH_SOURCE;
const base = 'version: 1\nslaves:\n  - id: 0\n    name: Drive\n    rx_pdos: [{index: 0x1600, entries: []}]\n    tx_pdos: [{index: 0x1a00, entries: []}]\n';
const command = (type: string, value: string) => base + `    init_commands: [{index: 0x2000, sub_index: 0, Type: ${type}, Value: ${value}}]\n`;
const cases = [
  ['defaults', base, true],
  ['empty mapping', base.replaceAll('entries: []', 'entries: {}'), true],
  ['empty null', base.replaceAll('entries: []', 'entries: null'), true],
  ['upper hex', base.replace('version: 1', 'version: 0X1'), true],
  ['quoted integer', base.replace('version: 1', 'version: "1"'), false],
  ['signed unsigned value', base.replace('version: 1', 'version: +1'), false],
  ['decimal float', base.replace('version: 1', 'version: 1.0'), false],
  ['unknown root key', base + 'extra: 1\n', false],
  ['unknown PDO key', base.replace('entries: []', 'entries: [], extra: 1'), false],
  ['missing entries', base.replace(', entries: []', ''), false],
  ['positive uint64 bound', command('uint64', '18446744073709551615'), true],
  ['negative int64 bound', command('int64', '-9223372036854775808'), true],
  ['positive int64 bound', command('int64', '9223372036854775807'), true],
  ['signed hex', command('int16', '0x7fff'), true],
  ['uint64 overflow', command('uint64', '18446744073709551616'), false],
  ['int64 underflow', command('int64', '-9223372036854775809'), false],
  ['int64 overflow', command('int64', '9223372036854775808'), false],
  ['quoted uint64', command('uint64', '"18446744073709551615"'), false],
  ['duplicate aliases', command('uint8', '1').replace('Type: uint8', 'Type: uint8, type: uint8'), false],
  ['lowercase aliases', command('uint32', '42').replace('Type:', 'type:').replace('Value:', 'value:'), true],
  ['invalid master timeout', base + 'master: {preop_timeout_ms: 0}\n', false],
  ['invalid reference boolean', base + '    dc_ref: "true"\n', false],
] as const;

describe.skipIf(!source)('IgH 3c92f2a native loader contract (no hardware)', () => {
  let temporary: string;
  let executable: string;
  beforeAll(() => {
    const revision = execFileSync('git', ['-C', source!, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(revision, 'Update the profile deliberately before changing its consumer baseline').toBe('3c92f2a');
    temporary = mkdtempSync(resolve(tmpdir(), 'rocos-igh-contract-'));
    executable = resolve(temporary, 'igh-loader');
    execFileSync('g++', ['-std=c++17', '-DROCOS_IGH_BUILD_MASTER=0', '-I' + resolve(source!, 'src'),
      'tests/consumer/igh-loader.cpp', resolve(source!, 'src/pdo_config.cpp'), '-lyaml-cpp', '-o', executable]);
  }, 30000);
  afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); });
  it.each(cases)('%s matches the native parser', (_, text, expected) => {
    const file = resolve(temporary, 'igh.yaml'); writeFileSync(file, text);
    const loaded = spawnSync(executable, [file], { encoding: 'utf8' });
    expect(loaded.status === 0, loaded.stderr).toBe(expected);
    const diagnostics = buildIghCatalog(makeFile('igh.yaml', 'igh', text)).diagnostics.filter(d => d.severity === 'error');
    expect(!diagnostics.length, JSON.stringify(diagnostics)).toBe(expected);
  });
  it('loads editor-generated output and encodes exact 64-bit values without truncation', () => {
    const p = planSlaveChange(createProject('contract', 'igh'), { kind: 'add' }).project;
    editProjectYaml(p, masterFileId(p), doc => {
      modifySequence(doc, ['slaves', 0, 'init_commands'], 'add', 0, { index: 0x2000, sub_index: 0, Type: 'uint64', Value: 18446744073709551615n });
      modifySequence(doc, ['slaves', 0, 'init_commands'], 'add', 0, { index: 0x2001, sub_index: 0, Type: 'int64', Value: -9223372036854775808n });
    });
    const file = resolve(temporary, 'edited.yaml'); writeFileSync(file, textOf(fileById(p, masterFileId(p))!));
    const result = execFileSync(executable, [file], { encoding: 'utf8' });
    expect(result).toBe('accepted\n255,255,255,255,255,255,255,255\n0,0,0,0,0,0,0,128\n');
  });
  it('accepts the real Talon sample from the pinned consumer repository', () => {
    const file = resolve(source!, 'config/talon_pdo.yaml');
    expect(spawnSync(executable, [file]).status).toBe(0);
    expect(buildIghCatalog(makeFile('igh.yaml', 'igh', readFileSync(file, 'utf8'))).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  });
  it('loads the bundled IgH teaching configuration with explicit PDO entries',()=>{
    const p=createExample('igh'),file=resolve(temporary,'teaching.yaml');writeFileSync(file,textOf(fileById(p,p.entrypoints.master.fileId)!));
    const result=spawnSync(executable,[file],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);
  });
});
