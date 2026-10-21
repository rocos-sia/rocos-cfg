import { describe, expect, it } from 'vitest';
import { inspectImport, applyImport, defaultImportSelection } from '../src/core/project/import';
import { resourceProject } from './fixtures/resources';
import { fileById, utf8, digest, textOf } from '../src/core/project/types';
import { openProject, saveProject } from '../src/core/project/archive';
import { prepareImport } from '../src/adapters/files';
import { LIMITS } from '../src/core/project/zip';
import { zipSync, strToU8 } from 'fflate';
import { compareBus } from '../src/core/bus/compare';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { targetStatus } from '../src/core/project/profiles';
import { useProject } from '../src/store';
const entries = (files: Record<string, string>) => new Map(Object.entries(files).map(([p, s]) => [p, utf8.encode(s)]));

describe('staged configuration imports', () => {
  it('requires an explicit choice among multiple configurations and retains every candidate and prior file', () => {
    const p = resourceProject(), original = structuredClone(p);
    const plan = inspectImport(p, entries({ 'one/config.yaml': 'eni: one.xml', 'two/config.yaml': 'eni: two.xml', 'three/config.yaml': 'version: 1\nslaves: []' }));
    expect(() => applyImport(p, plan)).toThrow('请选择 master');
    const next = applyImport(p, plan, { master: plan.files[1].id });
    expect(next.files.filter(f=>f.role!=='profile')).toHaveLength(p.files.filter(f=>f.role!=='profile').length + 3);
    expect(targetStatus(next,'master')).toMatchObject({supported:true,legacy:false});
    expect(next.files.some(f=>f.id===p.targets.master.profile?.fileId)).toBe(true);
    expect(fileById(next, next.entrypoints.master.fileId)?.path).toBe('two/config.yaml');
    expect(next.targets.master).toMatchObject({ version: 'e0e5e32', configVersion: 1, abi: 'unverified',profile:{id:'rocos.ecm',version:1} });
    expect(next.editor.confirmations).toEqual({});
    expect(p).toEqual(original);
  });
  it('retains a replaced source draft and its base hash, including through archive reopening', async () => {
    const p = resourceProject(), urdf = fileById(p, p.entrypoints.urdf)!;
    p.editor.buffers[urdf.id] = { text: '<robot name="draft"><link name="draft_base"/></robot>', baseHash: await digest(urdf.bytes) };
    const plan = inspectImport(p, entries({ 'replacement.urdf': '<robot name="new"><link name="new_base"/></robot>' }), true);
    const next = applyImport(p, plan);
    expect(fileById(next, next.entrypoints.urdf)?.path).toBe(urdf.path);
    expect(next.entrypoints.urdf).toBe(urdf.id);
    expect(next.editor.buffers).toEqual(p.editor.buffers);
    const reopened = await openProject(await saveProject(next));
    useProject.getState().load(reopened);
    await expect(useProject.getState().apply(urdf.id)).rejects.toThrow('基线冲突');
    expect(textOf(fileById(reopened, urdf.id)!)).toContain('name="new"');
  });
  it('keeps directory structure, existing configurations and unselected candidates', () => {
    const p = resourceProject();
    const plan = inspectImport(p, entries({ 'assembly/a.urdf': '<robot name="a"/>', 'assembly/b.urdf': '<robot name="b"/>' }));
    const next = applyImport(p, plan, { urdf: 'keep' });
    expect(next.entrypoints.urdf).toBe(p.entrypoints.urdf);
    expect(next.files.filter(f => f.role === 'urdf')).toHaveLength(3);
    expect(next.files.some(f => f.path === 'assembly/a.urdf')).toBe(true);
    expect(next.editor.confirmations).toEqual(p.editor.confirmations);
  });
  it('rejects stale plans, cross-project plans and configuration role collisions atomically', () => {
    const p = resourceProject();
    const plan = inspectImport(p, entries({ 'app/config.yaml': 'hardware: []' }));
    expect(() => applyImport(p, plan)).toThrow('用途');
    expect(() => applyImport({ ...p, revision: p.revision + 1 }, plan)).toThrow('已变化');
    expect(() => applyImport({ ...p, id: 'other' }, plan)).toThrow('已变化');
    const currentPath = fileById(p, p.entrypoints.urdf)!.path;
    const keep = inspectImport(p, entries({ [currentPath]: '<robot name="new"/>' }));
    expect(() => applyImport(p, keep, { urdf: 'keep' })).toThrow('不能覆盖');
    expect(defaultImportSelection(plan).hardware).toBe(plan.files[0].id);
  });
  it('keeps bytes of unsupported encodings and cannot classify them as an editable config', () => {
    const p = resourceProject();
    const plan = inspectImport(p, entries({ 'broken.urdf': '<?xml version="1.0" encoding="unsupported"?><robot name="r"/>' }));
    const next = applyImport(p, plan);
    expect(next.entrypoints.urdf).toBe(p.entrypoints.urdf);
    const imported = next.files.find(f => f.path === 'broken.urdf')!;
    expect(imported.role).toBe('attachment');
    expect(imported.bytes).toEqual(plan.files[0].bytes);
  });
});

it('enforces aggregate import limits across regular files and multiple ZIPs', async () => {
  const p = resourceProject(), limits = { ...LIMITS, file: 8, total: 10, entries: 4 };
  await expect(prepareImport(p, [new File(['123456789'], 'large.txt')], limits)).rejects.toThrow('限额');
  await expect(prepareImport(p, [new File(['123456'], 'one.txt'), new File(['123456'], 'two.txt')], limits)).rejects.toThrow('限额');
  const zip = (name: string) => new File([new Uint8Array(zipSync({ [name]: strToU8('123456') })).buffer], name + '.ZIP');
  await expect(prepareImport(p, [zip('one'), zip('two')], limits)).rejects.toThrow('限额');
  await expect(prepareImport(p, [new File(['1'], 'a'), new File(['2'], 'b')], { ...limits, entries: 1 })).rejects.toThrow('数量');
});
it('reports device identity and signal layout changes without equating runtime IDs with physical devices', () => {
  const before = buildBusCatalog(resourceProject());
  before.signals = [{ uid: 'old', slaveId: 0, direction: 'input', sourceName: 'Drive.Input.Position', runtimeName: 'Position', bitLength: 32, bitOffset: 0, storageBytes: 4, dataType: 'DINT', resolution: 'resolved' }];
  const after = structuredClone(before); after.slaves[0].address = 1005; after.slaves[0].product = '42';
  after.signals[0].uid = 'new'; after.signals[0].bitOffset = 32; after.signals[0].bitLength = 16;
  const delta = compareBus(before, after);
  expect(delta.map(d => d.change)).toEqual(['变化', '变化']);
  expect(delta[0].after).toContain('1005'); expect(delta[1].after).toContain('偏移=32');
  const unchanged = structuredClone(before); unchanged.signals[0].uid = 'new-file-id';
  expect(compareBus(before, unchanged)).toEqual([]);
  after.signals[0].runtimeName = 'Renamed';
  expect(compareBus(before, after).map(d => d.change)).toEqual(['变化', '删除', '新增']);
});
