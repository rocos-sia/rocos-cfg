import { describe, expect, it } from 'vitest';
import { prepareImport } from '../src/adapters/files';
import { applyImport, defaultImportSelection, importCandidates } from '../src/core/project/import';
import { createProject } from '../src/core/project/create';
import { configuration, enableSimulation, masterProject, selectMaster } from '../src/core/project/configuration';
import { fileById, textOf } from '../src/core/project/types';
import { readYaml } from '../src/core/documents/yaml';
import { collectReferences } from '../src/core/project/references';
import { openProject, saveProject } from '../src/core/project/archive';

function file(name: string, content: string, path?: string) {
  const result = new File([content], name);
  if (path) Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

describe('imports selected by configuration type', () => {
  it('rejects the wrong format and resolves ambiguous YAML only in the requested module', async () => {
    const project = createProject('typed', 'igh'), original = structuredClone(project);
    await expect(prepareImport(project, [file('config.yaml', 'eni: network.xml')], undefined, 'igh')).rejects.toThrow('未找到所选类型');
    const plan = await prepareImport(project, [file('config.yaml', 'version: 1\nslaves: []\nrobot: {}')], undefined, 'igh');
    expect([...importCandidates(plan).keys()]).toEqual(['master']);
    expect(plan.files[0].role).toBe('igh');
    expect(project).toEqual(original);
  });

  it('replaces each saved master separately when importing across master tabs', async () => {
    const project = createProject('masters', 'igh'), ighId = project.entrypoints.master.fileId;
    selectMaster(project, 'ecm');
    const ecmId = project.entrypoints.master.fileId;
    const ighPlan = await prepareImport(project, [file('config.yaml', 'version: 1\nmaster: {master_id: 7}\nslaves: []')], undefined, 'igh');
    const next = applyImport(project, ighPlan);
    expect(next.entrypoints.master).toMatchObject({ kind: 'igh', fileId: ighId });
    expect(fileById(next, ecmId)).toEqual(fileById(project, ecmId));
    expect(masterProject(next, 'ecm').entrypoints.master.fileId).toBe(ecmId);
    const ecmPlan = await prepareImport(next, [file('config.yaml', 'eni: network.xml\nid: 8\ncycle: 2000')], undefined, 'ecm');
    const ecm = applyImport(next, ecmPlan);
    expect(ecm.entrypoints.master).toMatchObject({ kind: 'ecm', fileId: ecmId });
    expect(readYaml(textOf(fileById(ecm, ighId)!)).master.master_id).toBe(7n);
  });

  it('links payload and hardware imports to APP, retains drafts, and survives archive reopening', async () => {
    const project = createProject('app', 'igh');
    const plan = await prepareImport(project, [file('tool.yaml', 'mass: 2.5\ncom: [0, 0, 0.1]')], undefined, 'app.payload');
    const next = applyImport(project, plan);
    const payload = next.files.find(f => f.role === 'app.payload')!;
    expect(readYaml(textOf(fileById(next, next.entrypoints.app)!)).robot.payload).toBe('payloads/tool.yaml');
    expect(collectReferences(next).find(r => r.field === 'robot.payload')).toMatchObject({ state: 'internal', targetFileId: payload.id });
    const hardwareId = next.entrypoints.hardware!;
    next.editor.buffers[hardwareId] = { text: 'hardware: [draft]', baseHash: 'original' };
    const hardwarePlan = await prepareImport(next, [file('vendor.yaml', 'hardware: []')], undefined, 'hardware');
    const restored = await openProject(await saveProject(applyImport(next, hardwarePlan)));
    expect(restored.entrypoints.hardware).toBe(hardwareId);
    expect(restored.editor.buffers[hardwareId]).toEqual(next.editor.buffers[hardwareId]);
    expect(restored.files.find(f => f.role === 'app.payload')?.id).toBe(payload.id);
    expect(collectReferences(restored).find(r => r.field === 'robot.hardware_config')).toMatchObject({ state: 'internal', targetFileId: hardwareId });
  });

  it('keeps a payload named config.yaml separate from APP startup configuration', async () => {
    const project = createProject('same name', 'igh'), appId = project.entrypoints.app;
    const plan = await prepareImport(project, [file('config.yaml', 'mass: 2')], undefined, 'app.payload');
    const next = applyImport(project, plan);
    expect(next.entrypoints.app).toBe(appId);
    expect(fileById(next, appId)?.path).toBe('app/config.yaml');
    expect(readYaml(textOf(fileById(next, appId)!)).robot.payload).toBe('payloads/config.yaml');
    expect(next.files.find(f => f.path === 'app/payloads/config.yaml')?.role).toBe('app.payload');
  });

  it('imports a URDF folder without activating unrelated YAML and links the selected model and meshes', async () => {
    const project = createProject('robot', 'igh');
    const plan = await prepareImport(project, [
      file('arm.urdf', '<robot name="arm"><link name="base"><visual><geometry><mesh filename="meshes/part.stl"/></geometry></visual></link></robot>', 'arm/arm.urdf'),
      file('part.stl', 'solid part\nendsolid part', 'arm/meshes/part.stl'),
      file('config.yaml', 'eni: unrelated.xml', 'arm/config.yaml'),
    ], undefined, 'urdf');
    expect([...importCandidates(plan).keys()]).toEqual(['urdf']);
    const next = applyImport(project, plan), refs = collectReferences(next);
    expect(next.entrypoints.master).toEqual(project.entrypoints.master);
    expect(fileById(next, next.entrypoints.urdf)?.path).toBe('models/arm.urdf');
    expect(refs.find(r => r.field === 'robot.urdf')).toMatchObject({ state: 'internal', targetFileId: next.entrypoints.urdf });
    expect(refs.find(r => r.sourceFileId === next.entrypoints.urdf && r.field === 'mesh[0].filename')?.state).toBe('internal');
  });

  it('keeps MJCF includes and assets together and excludes includes from entry model choices', async () => {
    const project = createProject('simulation', 'igh'); enableSimulation(project);
    const plan = await prepareImport(project, [
      file('scene.xml', '<mujoco><include file="parts/arm.xml"/></mujoco>', 'model/scene.xml'),
      file('arm.xml', '<mujocoinclude><asset><mesh name="part" file="part.stl"/></asset></mujocoinclude>', 'model/parts/arm.xml'),
      file('part.stl', 'solid part\nendsolid part', 'model/parts/part.stl'),
      file('hardware.yaml', 'hardware: []', 'model/hardware.yaml'),
    ], undefined, 'mjcf');
    expect(importCandidates(plan).get('mjcf')).toHaveLength(1);
    expect(defaultImportSelection(plan).mjcf).toBe(plan.files[0].id);
    const next = applyImport(project, plan);
    expect(next.files.find(f => f.path === 'simulation/models/hardware.yaml')?.role).toBe('simulation-hardware');
    expect(readYaml(textOf(fileById(next, configuration(next).simulationFileId)!)).model).toBe('models/scene.xml');
    expect(collectReferences(next).filter(r => ['include[0].file', 'mesh[0].file'].includes(r.field)).map(r => r.state)).toEqual(['internal', 'internal']);
    const config = await prepareImport(next, [file('run.yaml', 'model: models/scene.xml\nhardware_config: models/hardware.yaml\nduration_sec: 12')], undefined, 'mujoco');
    const restored = await openProject(await saveProject(applyImport(next, config)));
    expect(configuration(restored).simulationFileId).toBe(configuration(project).simulationFileId);
    expect(collectReferences(restored).find(r => r.sourceFileId === configuration(restored).simulationFileId && r.field === 'hardware_config')?.state).toBe('internal');
  });

  it('requires a choice among multiple models and rejects stale plans or conflicting APP drafts atomically', async () => {
    const project = createProject('draft', 'igh');
    const plan = await prepareImport(project, [file('a.urdf', '<robot name="a"/>'), file('b.urdf', '<robot name="b"/>')], undefined, 'urdf');
    expect(() => applyImport(project, plan)).toThrow('请选择 urdf');
    const selection = { urdf: plan.files[0].id };
    expect(() => applyImport({ ...project, revision: project.revision + 1 }, plan, selection)).toThrow('工程已变化');
    project.editor.buffers[project.entrypoints.app!] = { text: 'robot: {}', baseHash: 'original' };
    const before = structuredClone(project);
    expect(() => applyImport(project, plan, selection)).toThrow('关联配置的源码草稿');
    expect(project).toEqual(before);
  });
});
