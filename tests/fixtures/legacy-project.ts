import { createProject as create, type ProjectOptions } from '../../src/core/project/create';
import { type MasterKind, fileById, utf8 } from '../../src/core/project/types';
import legacy from '../../templates/projects/starter.v2.json';
import { stringify } from 'yaml';
export function createLegacyProject(name: string, kind: MasterKind, options: ProjectOptions = {}) {
  const p = create(name, kind, options, true);
  if (kind === 'igh' && (!options.pdoTemplate || options.pdoTemplate === 'blank')) fileById(p,p.entrypoints.master.fileId)!.bytes = utf8.encode(stringify(legacy.data.igh));
  return p;
}
