import { describe, expect, it } from 'vitest';
import { modules } from '../src/core/modules';
import { ModuleRegistry } from '../src/core/modules/registry';
import type { ConfigModule } from '../src/core/modules/contracts';
import { moduleSnapshots, readonlyFile } from '../src/core/modules/project';
import { resourceProject } from './fixtures/resources';
import { fileById, textOf, utf8, digest } from '../src/core/project/types';
import { makeFile } from '../src/core/project/create';
import { inspectImport, applyImport } from '../src/core/project/import';
import { openProject, saveProject, inspectProjectArchive } from '../src/core/project/archive';
import { packZip, unpackZip, LIMITS } from '../src/core/project/zip';
import { readYaml, patchYaml, yamlDocument } from '../src/core/documents/yaml';
import { collectReferences } from '../src/core/project/references';
import { mapReference, moveResource } from '../src/core/project/resources';
import { exportRuntime } from '../src/core/export';
import { validateProject } from '../src/core/validation';
import { useProject } from '../src/store';
const calibration: ConfigModule = {
  id: 'test.calibration', version: 2, role: 'test.calibration',
  capabilities: { readonly: false, generate: false, advancedEdit: true, desktop: false },
  detect: f => /\.ya?ml$/.test(f.path) && !!readYaml(textOf(f))?.calibration,
  parse: f => readYaml(textOf(f)),
  validate: (v, { file }) => v.calibration.enabled === true ? [] : [{ code: 'test.enabled', message: 'Calibration disabled', fileId: file.id, severity: 'error' }],
  references: v => [{ field: 'calibration.table', original: v.calibration.table }],
  export: (_, ctx) => {
    const doc = yamlDocument(textOf(ctx.file)); for (const r of ctx.rewrites) doc.setIn(r.field.split('.'), r.value);
    return [{ path: ctx.path, bytes: utf8.encode(doc.toString()), fileId: ctx.file.id }];
  },
};
const extended = new ModuleRegistry([...modules.all(), calibration]);
function editManifest(bytes: Uint8Array, edit: (m: any) => void) {
  const files = unpackZip(bytes), m = JSON.parse(new TextDecoder().decode(files.get('rocos-project.json')));
  edit(m); files.set('rocos-project.json', utf8.encode(JSON.stringify(m))); return packZip(files);
}
function unknownProject() {
  const p = resourceProject();
  const file = makeFile('extensions/opaque.custom', 'vendor.opaque', 'retained bytes\n'); file.owner = 'vendor.opaque';
  const state = makeFile('project-data/vendor.opaque/state.json', 'vendor.state', '{"secretMeaning":[1,2]}'); state.owner = 'vendor.opaque';
  p.files.push(file, state);
  p.modules = [{ id: 'vendor.opaque', version: 7, instanceId: 'vendor:one', required: false, fileIds: [file.id], stateFileIds: [state.id], metadata: { future: ['opaque', { x: 3 }] } }];
  p.references.push({ sourceFileId: file.id, original: '../resource.bin', field: 'future.ref', state: 'missing' });
  return { p, file, state };
}

describe('compiled configuration modules', () => {
  it('adds detection, validation, references, archive persistence and runtime rewriting without changing the workflows', async () => {
    const p = resourceProject();
    const plan = inspectImport(p, new Map([['extra/calibration.yaml', utf8.encode('# preserve\ncalibration:\n  enabled: true\n  table: ../data/table.bin\n')], ['data/table.bin', new Uint8Array([1, 2, 3])]]), false, extended);
    const next = applyImport(p, plan, {}, extended), file = next.files.find(f => f.role === 'test.calibration')!;
    expect(file.owner).toBe('test.calibration');
    next.modules = [{ id: calibration.id, version: 2, instanceId: 'calibration:one', required: false, fileIds: [file.id], runtimeFileIds: [file.id] }];
    expect(collectReferences(next, extended).find(r => r.sourceFileId === file.id)?.state).toBe('internal');
    const restored = await openProject(await saveProject(next, 'test', extended), LIMITS, extended);
    const bin = restored.files.find(f => f.path === 'data/table.bin')!;
    restored.references = collectReferences(restored, extended); bin.path = 'assets/table.bin';
    const output = unpackZip(exportRuntime(restored, extended));
    expect(new TextDecoder().decode(output.get(file.path))).toContain('../assets/table.bin');
    expect(new TextDecoder().decode(output.get(file.path))).toContain('# preserve');
    expect(output.get(bin.path)).toEqual(bin.bytes);
    expect(textOf(fileById(restored, file.id)!)).toContain('../data/table.bin');
    fileById(restored, file.id)!.bytes = utf8.encode('calibration: {enabled: false, table: ../assets/table.bin}');
    expect(validateProject(restored, extended).some(d => d.code === 'test.enabled')).toBe(true);
    expect(() => exportRuntime(restored, extended)).toThrow('错误');
    expect(() => new ModuleRegistry([calibration, calibration])).toThrow('重复');
  });
  it('preserves unknown optional module data, file metadata, state and references across editing and saving', async () => {
    const { p, file, state } = unknownProject();
    const raw = editManifest(await saveProject(p), m => { m.vendorRoot = { untouched: true }; m.files.find((f: any) => f.id === file.id).vendorInfo = ['extra']; });
    const restored = await openProject(raw);
    restored.name = 'edited';
    const saved = unpackZip(await saveProject(restored, 'next'));
    const manifest = JSON.parse(new TextDecoder().decode(saved.get('rocos-project.json')));
    expect(manifest.modules.find((m: any) => m.id === 'vendor.opaque')).toEqual(p.modules![0]);
    expect(manifest.vendorRoot).toEqual({ untouched: true });
    expect(manifest.files.find((f: any) => f.id === file.id).vendorInfo).toEqual(['extra']);
    expect(saved.get(file.path)).toEqual(file.bytes); expect(saved.get(state.path)).toEqual(state.bytes);
    expect(manifest.references.find((r: any) => r.sourceFileId === file.id)).toEqual(p.references.find(r => r.sourceFileId === file.id));
    expect(manifest.createdWith.version).toBe('development'); expect(manifest.lastSavedWith.version).toBe('next');
    expect(validateProject(restored).find(d => d.code === 'module.unsupported')?.severity).toBe('warning');
    expect(unpackZip(exportRuntime(restored)).has(file.path)).toBe(false);
  });
  it('blocks unknown active dependencies and prevents editing or replacing their files', async () => {
    const { p, file } = unknownProject();
    useProject.getState().load(p);
    expect(readonlyFile(p, file)).toBe(true);
    await expect(useProject.getState().buffer(file.id, 'changed')).rejects.toThrow('只读');
    expect(() => useProject.getState().yaml(file.id, ['x'], 1)).toThrow('不受支持');
    expect(() => moveResource(p, file.id, 'new.custom')).toThrow('未知模块');
    const replacement = inspectImport(p, new Map([[file.path, utf8.encode('new')]]));
    expect(() => applyImport(p, replacement)).toThrow('不能覆盖未知模块');
    const app = fileById(p, p.entrypoints.app)!; app.bytes = utf8.encode(patchYaml(textOf(app), ['robot', 'payload'], '../extensions/opaque.custom'));
    expect(validateProject(p).find(d => d.code === 'module.unsupported')?.severity).toBe('error');
    expect(() => exportRuntime(p)).toThrow('错误');
    // Saving an invalid runtime project is still allowed.
    expect((await openProject(await saveProject(p))).modules?.[0]).toEqual(p.modules![0]);
  });
  it('returns unsupported required modules and future formats as an exact original archive, without editable loading', async () => {
    const { p } = unknownProject(), raw = await saveProject(p);
    for (const altered of [editManifest(raw, m => { m.modules.find((v: any) => v.id === 'vendor.opaque').required = true; }), editManifest(raw, m => { m.formatVersion = 42; })]) {
      const result = await inspectProjectArchive(altered); expect(result.mode).toBe('readonly');
      if (result.mode !== 'readonly') throw new Error('Expected readonly');
      expect(await digest(result.original)).toBe(await digest(altered)); expect(result.summary.name).toBe(p.name);
      await expect(openProject(altered)).rejects.toThrow(/版本|必要模块/);
    }
    const corrupt = unpackZip(editManifest(raw, m => { m.modules[0].required = true; })); corrupt.set('extensions/opaque.custom', utf8.encode('tampered'));
    await expect(inspectProjectArchive(packZip(corrupt))).rejects.toThrow(/长度|SHA-256/);
  });
  it('rejects duplicate ownership, validates dependency cycles and excludes tool state from runtime output', async () => {
    const p = resourceProject(), files = p.files.filter(f => f.role === 'resource').slice(0, 2);
    p.modules = files.map((f, i) => ({ id: 'resource', version: 1, instanceId: `r${i}`, required: false, fileIds: [f.id], runtimeFileIds: [f.id], dependsOn: [`r${1 - i}`] }));
    expect(validateProject(p).some(d => d.code === 'module.cycle')).toBe(true);
    expect(() => exportRuntime(p)).toThrow('错误');
    p.modules[0].dependsOn = ['missing']; p.modules[1].dependsOn = [];
    expect(validateProject(p).some(d => d.code === 'module.dependency')).toBe(true);
    const raw = await saveProject(resourceProject());
    await expect(openProject(editManifest(raw, m => m.modules.push({ ...m.modules[0], instanceId: 'another' })))).rejects.toThrow('重复拥有');
  });
  it('maintains the ENI byte invariant even if a compiled exporter accidentally changes XML', () => {
    const p = resourceProject(), file = makeFile('master/extra.xml', 'eni', '<EtherCATConfig/>'); p.files.push(file);
    p.modules = [{ id: 'eni', version: 1, instanceId: 'eni-extra', required: true, fileIds: [file.id], runtimeFileIds: [file.id] }];
    const bad = { ...modules.get('eni')!, export: (_: unknown, ctx: any) => [{ path: ctx.path, bytes: utf8.encode('<changed/>') }] };
    const registry = new ModuleRegistry([...modules.all().filter(m => m.id !== 'eni'), bad]);
    expect(() => exportRuntime(p, registry)).toThrow('原始字节');
  });
  it('imports and validates real payload fields and keeps multiple instances separate', async () => {
    const p = resourceProject();
    const plan = inspectImport(p, new Map([['loads/a.yaml', utf8.encode('# a\nmass: 2.5\ncom: [0.1, 0, 0, 4]\nextra: retain\n')], ['loads/b.yaml', utf8.encode('mass: -1')]]));
    const next = applyImport(p, plan); expect(plan.files.every(f => f.owner === 'app.payload')).toBe(true);
    const app = fileById(next, next.entrypoints.app)!; app.bytes = utf8.encode(patchYaml(textOf(app), ['robot', 'payload'], '../loads/a.yaml'));
    expect(validateProject(next).filter(d => d.severity === 'error')).toEqual([]);
    const snapshots = moduleSnapshots(next).filter(m => m.id === 'app.payload'); expect(snapshots).toHaveLength(2); expect(snapshots[0].instanceId).not.toBe(snapshots[1].instanceId);
    expect(unpackZip(exportRuntime(next)).get('loads/a.yaml')).toEqual(plan.files[0].bytes);
    app.bytes = utf8.encode(patchYaml(textOf(app), ['robot', 'payload'], '../loads/b.yaml'));
    expect(validateProject(next).some(d => d.code === 'payload.value' && d.severity === 'error')).toBe(true);
    expect((await openProject(await saveProject(next))).files.filter(f => f.role === 'app.payload')).toHaveLength(2);
  });
});

it('traverses fileless dependency modules, refuses editor state as a runtime dependency, and respects platform capabilities', async () => {
  const { activeFileIds } = await import('../src/core/project/references');
  const p = resourceProject(), extra = makeFile('extra/keep.txt', 'resource', 'runtime resource'); p.files.push(extra);
  p.modules = [
    { id: 'resource', version: 1, instanceId: 'group', required: false, requiredForRuntime: true, fileIds: [], dependsOn: ['nested'] },
    { id: 'resource', version: 1, instanceId: 'nested', required: false, fileIds: [], dependsOn: ['file'] },
    { id: 'resource', version: 1, instanceId: 'file', required: false, fileIds: [extra.id] },
  ];
  expect(activeFileIds(p).has(extra.id)).toBe(true); expect(unpackZip(exportRuntime(p)).get(extra.path)).toEqual(extra.bytes);
  p.modules[2].fileIds = []; p.modules[2].stateFileIds = [extra.id];
  const app = fileById(p, p.entrypoints.app)!; app.bytes = utf8.encode(patchYaml(textOf(app), ['robot', 'payload'], '../extra/keep.txt'));
  expect(validateProject(p).some(d => d.code === 'module.state')).toBe(true);
  const desktopModule = { ...calibration, capabilities: { ...calibration.capabilities, desktop: true } };
  const registry = new ModuleRegistry([...modules.all(), desktopModule]);
  const desktop = makeFile('desktop.yaml', 'test.calibration', 'calibration: {enabled: true, table: extra/keep.txt}');
  p.files.push(desktop); p.modules = [{ id: calibration.id, version: 2, required: false, fileIds: [desktop.id], requiredForRuntime: true }];
  expect(readonlyFile(p, desktop, registry)).toBe(true);
  expect(validateProject(p, registry).some(d => d.code === 'module.desktop')).toBe(true);
  const native = new ModuleRegistry([...modules.all(), desktopModule], 'desktop');
  expect(readonlyFile(p, desktop, native)).toBe(false);
});

it('does not silently interpret a missing unknown core owner or a mismatched known module declaration', async () => {
  const p = resourceProject(), raw = await saveProject(p);
  const unknownOwner = editManifest(raw, m => {
    m.modules = m.modules.filter((v: any) => !v.fileIds.includes(m.entrypoints.app));
    m.files.find((f: any) => f.id === m.entrypoints.app).owner = 'future.app';
  });
  expect((await inspectProjectArchive(unknownOwner)).mode).toBe('readonly');
  const mismatch = editManifest(raw, m => { const mod = m.modules.find((v: any) => v.fileIds.includes(m.entrypoints.app)); mod.id = 'app.payload'; });
  await expect(openProject(mismatch)).rejects.toThrow('文件角色不一致');
});

it('uses the module parser when applying source drafts regardless of the filename extension', async () => {
  const p = resourceProject(), f = makeFile('loads/tool.custom', 'app.payload', 'mass: 1\n'); p.files.push(f);
  useProject.getState().load(p);
  await useProject.getState().buffer(f.id, 'mass: [broken');
  await expect(useProject.getState().apply(f.id)).rejects.toThrow();
  expect(textOf(fileById(useProject.getState().project!, f.id)!)).toBe('mass: 1\n');
  expect(useProject.getState().project?.editor.buffers[f.id].text).toBe('mass: [broken');
  await useProject.getState().buffer(f.id, 'mass: 2\n'); await useProject.getState().apply(f.id);
  expect(textOf(fileById(useProject.getState().project!, f.id)!)).toBe('mass: 2\n');
});
