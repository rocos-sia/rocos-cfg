import { expect, it } from 'vitest';
import { configurationStatus } from '../src/core/project/configuration-status';
import { createProject, makeFile } from '../src/core/project/create';
import { configure, enableSimulation, selectMaster } from '../src/core/project/configuration';

it('counts existing configuration and missing payload without counting resources, metadata or inactive files', () => {
  const project = createProject('status', 'igh');
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 6 });
  project.files.push(makeFile('unlinked.yaml', 'app.payload', 'mass: 1'), makeFile('models/mesh.stl', 'resource', 'solid mesh'));
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 6 });
  project.files.push(makeFile('app/payload.yaml', 'app.payload', 'mass: 1'));
  expect(configurationStatus(project)).toEqual({ configured: 6, total: 6 });
  project.files = project.files.filter(f => f.id !== project.entrypoints.hardware);
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 6 });
});

it('counts both enabled masters and the required ENI, updating when modules or masters are disabled', () => {
  const project = createProject('status', 'ecm');
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 7 });
  selectMaster(project, 'igh');
  expect(configurationStatus(project)).toEqual({ configured: 6, total: 8 });
  configure(project).disabledMasters = ['ecm'];
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 6 });
  configure(project).enabled.app = false;
  expect(configurationStatus(project)).toEqual({ configured: 1, total: 1 });
  configure(project).enabled.bus = false;
  expect(configurationStatus(project)).toEqual({ configured: 0, total: 0 });
});

it('counts simulation configuration, hardware and nested MJCF includes once, excluding meshes and textures', () => {
  const project = createProject('status', 'igh'); enableSimulation(project);
  expect(configurationStatus(project)).toEqual({ configured: 7, total: 9 });
  project.files.push(makeFile('simulation/models/scene.xml', 'mjcf', '<mujoco><include file="parts/arm.xml"/><include file="parts/arm.xml"/><asset><mesh file="mesh.stl"/></asset></mujoco>'));
  expect(configurationStatus(project)).toEqual({ configured: 8, total: 10 });
  project.files.push(makeFile('simulation/models/parts/arm.xml', 'mjcf', '<mujocoinclude><include file="../scene.xml"/></mujocoinclude>'));
  expect(configurationStatus(project)).toEqual({ configured: 9, total: 10 });
  configure(project).enabled.simulation = false;
  expect(configurationStatus(project)).toEqual({ configured: 5, total: 6 });
});
