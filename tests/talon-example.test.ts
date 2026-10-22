import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createTalonExample } from '../src/core/project/talon-example';
import { talonTemplate, validateTemplates } from '../src/core/project/templates';
import { openProject, saveProject } from '../src/core/project/archive';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { analyzeProject } from '../src/core/project/analysis';
import { planRuntime } from '../src/core/export';
import { validateProject } from '../src/core/validation';
import { digest, fileById, textOf } from '../src/core/project/types';
import { readYaml } from '../src/core/documents/yaml';
import { activeFileIds } from '../src/core/project/references';

const inputs = async () => new Map(await Promise.all(talonTemplate().data.files.map(async ({path}) =>
  [path, new Uint8Array(await readFile(new URL('../public/examples/talon/'+path, import.meta.url)))] as const)));

for (const kind of ['ecm', 'igh'] as const) it(`Talon ${kind} preserves both masters, all seven axes and local resources across archive roundtrip`, async () => {
  const entries = await inputs(), p = await createTalonExample(kind, entries);
  const other = await createTalonExample(kind, entries);
  expect(other.id).not.toBe(p.id);
  expect(other.snapshotId).not.toBe(p.snapshotId);
  expect(other.files.some(f => p.files.some(old => old.id === f.id))).toBe(false);
  const analysis = analyzeProject(p, 0), bus = buildBusCatalog(p);
  expect(analysis.chainError).toBeUndefined();
  expect(analysis.chain.map(j => j.name)).toEqual(Array.from({length: 7}, (_, i) => `joint_${i+1}`));
  expect(analysis.robot!.links).toHaveLength(8);
  expect(bus.diagnostics).toEqual([]);
  expect(bus.slaves).toHaveLength(7);
  expect(bus.signals.length).toBe(kind === 'igh' ? 77 : 91);
  expect(p.files.filter(f => /\.stl$/i.test(f.path))).toHaveLength(8);
  expect(p.references.length).toBeGreaterThan(20);
  expect(p.references.every(r => r.state === 'internal')).toBe(true);
  expect(validateTemplates(p)).toEqual([]);
  expect(p.editor.confirmations).toEqual({});
  const app = readYaml(textOf(fileById(p, p.entrypoints.app)!));
  expect(app.robot.base_link).toBe('base_link');
  expect(app.robot.tip_link).toBe('link_7');
  expect(readYaml(textOf(p.files.find(f => f.path === 'ecm/config.yaml')!)).license).toBe('');
  const active = activeFileIds(p);
  expect(active.has(p.files.find(f => f.path === (kind === 'ecm' ? 'igh/talon_pdo.yaml' : 'ecm/config.yaml'))!.id)).toBe(false);
  expect(active.has(p.files.find(f => f.path === 'ecm/eni7.xml')!.id)).toBe(kind === 'ecm');
  const errors = validateProject(p).filter(d => d.severity === 'error');
  expect(errors.filter(d => d.code === 'hardware.confirmation')).toHaveLength(7);
  expect([...new Set(errors.map(d => d.code))].sort()).toEqual(['hardware.confirmation']);
  const restored = await openProject(await saveProject(p));
  for (const [path, bytes] of entries) {
    expect(await digest(restored.files.find(f => f.path === path)!.bytes), path).toBe(await digest(bytes));
  }
  expect(restored.entrypoints).toEqual(p.entrypoints);
  expect(restored.packageMap).toEqual(p.packageMap);
  expect(restored.editor.confirmations).toEqual({});
  expect(validateTemplates(restored)).toEqual([]);
  expect(buildBusCatalog(restored)).toEqual(bus);
  for (let i = 0; i < 7; i++) restored.editor.confirmations[`drive:${i}`] = true;
  const runtime = planRuntime(restored);
  expect(runtime.external).toEqual([]);
  expect(runtime.files.filter(f => /\.stl$/i.test(f.path))).toHaveLength(8);
  expect(runtime.files.some(f => f.path.startsWith(kind === 'ecm' ? 'igh/' : 'ecm/'))).toBe(false);
  if (kind === 'ecm') expect(await digest(runtime.files.find(f => f.path === 'ecm/eni7.xml')!.bytes)).toBe(await digest(entries.get('ecm/eni7.xml')!));
  // Opening another copy must not share mutable bytes with the source or prior project.
  const mesh = p.files.find(f => /\.stl$/i.test(f.path))!;
  mesh.bytes[0] ^= 0xff;
  expect(await digest(other.files.find(f => f.path === mesh.path)!.bytes)).toBe(await digest(entries.get(mesh.path)!));
});

it('rejects missing or changed Talon assets before opening an incomplete example', async () => {
  const entries = await inputs();
  entries.delete('ecm/eni7.xml');
  await expect(createTalonExample('igh', entries)).rejects.toThrow('ecm/eni7.xml');
  const changed = await inputs();
  changed.get('app/talon/meshes/link_7.STL')![0] ^= 0xff;
  await expect(createTalonExample('ecm', changed)).rejects.toThrow('link_7.STL');
});
