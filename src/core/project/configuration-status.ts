import { configuration, masterKinds, masterProject } from './configuration';
import { robotConfigFile } from '../documents/app-config';
import { collectReferences } from './references';
import { fileById, type Project } from './types';
import { resourcePath } from './paths';

/** Counts configuration files required by enabled modules, including missing dependencies. */
export function configurationStatus(project: Project) {
  const config = configuration(project);
  // Only configuration sources matter here; do not parse large DAE/glTF assets.
  const references = collectReferences({ ...project, files: project.files.filter(f => !['resource', 'profile', 'template', 'editor-state'].includes(f.role)) });
  const files = new Map<string, boolean>(), models = new Set<string>();
  const add = (id: string | null | undefined, missing: string) => {
    const file = fileById(project, id);
    files.set(file ? `file:${file.id}` : missing, !!file);
    if (file?.role === 'mjcf') models.add(file.id);
  };
  const reference = (sourceId: string | null | undefined, field: string, fallback: string) => {
    const ref = references.find(r => r.sourceFileId === sourceId && r.field === field);
    const source = fileById(project, sourceId);
    const path = ref && source && resourcePath(source.path, ref.original, project.packageMap, ref.uri);
    add(ref?.state === 'internal' ? ref.targetFileId : undefined, path ? `path:${path}` : fallback);
  };
  if (config.enabled.bus) for (const kind of masterKinds(project)) {
    const entry = masterProject(project, kind).entrypoints.master;
    add(entry.fileId, `master:${kind}`);
    if (kind === 'ecm' || references.some(r=>r.sourceFileId===entry.fileId&&r.field==='eni')) {
      reference(entry.fileId, 'eni', 'master:eni');
    }
  }
  if (config.enabled.app) {
    for (const slot of ['app', 'urdf', 'hardware'] as const) add(project.entrypoints[slot], `app:${slot}`);
    if(project.entrypoints.binding)add(project.entrypoints.binding,'app:binding');
    if(robotConfigFile(project)?.role==='app.robot'){
      for(const field of ['robot_config','device_config','user_config'])if(references.some(r=>r.sourceFileId===project.entrypoints.app&&r.field===field))reference(project.entrypoints.app,field,'app:'+field);
    }else reference(project.entrypoints.app, 'robot.payload', 'app:payload');
  }
  if (config.enabled.simulation) {
    add(config.simulationFileId, 'simulation:config');
    const modelField = references.some(r => r.sourceFileId === config.simulationFileId && r.field === 'model') ? 'model' : 'urdf';
    reference(config.simulationFileId, modelField, 'simulation:model');
    reference(config.simulationFileId, 'hardware_config', 'simulation:hardware');
  }
  // MJCF include files are configuration; meshes and textures are resources.
  for (const id of models) {
    for (const ref of references.filter(r => r.sourceFileId === id && /^include\[\d+\]\.file$/.test(r.field))) {
      reference(id, ref.field, `mjcf:${id}:${ref.field}`);
    }
  }
  return { configured: [...files.values()].filter(Boolean).length, total: files.size };
}
