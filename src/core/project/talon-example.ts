import { createProject } from './create';
import { selectMaster } from './configuration';
import { recordTemplate, talonTemplate } from './templates';
import { collectReferences } from './references';
import { digest, uid, type MasterKind, type ProjectFile } from './types';
import { m as msg, MessageError } from './messages';

/** Both master configurations are retained; only the selected master is active. */
export async function createTalonExample(kind: MasterKind, entries: Map<string, Uint8Array>) {
  const template = talonTemplate();
  const files: ProjectFile[] = await Promise.all(template.data.files.map(async spec => {
    const bytes = entries.get(spec.path);
    if (!bytes || await digest(bytes) !== spec.sha256) {
      throw new MessageError(msg('Talon 示例文件缺失或损坏：{path}', {path: spec.path}));
    }
    return {id: uid(), path: spec.path, role: spec.role, owner: spec.role, bytes: new Uint8Array(bytes),
      ...(/\.STL$/i.test(spec.path) ? {} : {encoding: 'utf-8'})};
  }));
  const p = createProject('Talon', kind);
  // Starter documents were replaced, so retain only the target rule snapshots.
  p.files = [...p.files.filter(file => file.role === 'profile'), ...files];
  p.editor = {buffers: {}, confirmations: {}};
  const id = (path: string) => files.find(file => file.path === path)!.id;
  p.entrypoints = {
    master: {kind, fileId: id(kind === 'igh' ? 'igh/talon_pdo.yaml' : 'ecm/config.yaml'),
      eniFileId: kind === 'ecm' ? id('ecm/eni7.xml') : null},
    app: id('app/config.yaml'), urdf: id('app/talon/robot.urdf'),
    hardware: id('app/hardware_talon_config.yaml'), binding: id('app/joint_binding.yaml'),
  };
  p.packageMap = {self_robot_description: 'app/talon'};
  p.description = template.notice;
  p.editor.notices = [{fileId: p.entrypoints.app!, message: template.notice}];
  p.references = collectReferences(p);
  recordTemplate(p, template, {master: kind}, files.map(file => file.id));
  return p;
}

/** Assets ship with the app and are included in its offline cache. */
export async function loadTalonExample(kind: MasterKind = 'igh') {
  const entries = await Promise.all(talonTemplate().data.files.map(async ({path}) => {
    const response = await fetch(`${import.meta.env.BASE_URL}examples/talon/${path}`);
    if (!response.ok) throw new MessageError(msg('无法加载 Talon 示例文件：{path}', {path}));
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  const project = await createTalonExample(kind, new Map(entries));
  // Both tabs open their bundled configuration, including ECM's read-only ENI.
  selectMaster(project, kind === 'igh' ? 'ecm' : 'igh');
  if (project.entrypoints.master.kind === 'ecm') project.entrypoints.master.eniFileId = project.files.find(file => file.path === 'ecm/eni7.xml')!.id;
  selectMaster(project, kind);
  project.references = collectReferences(project);
  return project;
}
