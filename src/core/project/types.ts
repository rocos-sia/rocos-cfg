export type MasterKind = 'igh' | 'ecm';
export type BuiltinFileRole = 'igh' | 'ecm' | 'eni' | 'urdf' | 'hardware' | 'binding' | 'app' | 'resource' | 'attachment' | 'editor-state' | 'profile' | 'template';
export type FileRole = BuiltinFileRole | (string & {});
export interface ModuleSnapshot {
  id: string; version: number; instanceId?: string; required: boolean; requiredForRuntime?: boolean;
  fileIds: string[]; stateFileIds?: string[]; runtimeFileIds?: string[]; dependsOn?: string[];
  [key: string]: unknown;
}
export interface ProjectFile {
  id: string; path: string; role: FileRole; owner: string; bytes: Uint8Array; encoding?: string;
}
export interface TargetProfile { version: string; configVersion: number; abi: string; profile?:{id:string;version:number;fileId:string} }
export interface EntryPoints {
  master: { kind: MasterKind; fileId: string | null; eniFileId: string | null };
  app: string | null; urdf: string | null; hardware: string | null; binding: string | null;
}
export interface FileReference { sourceFileId: string; field: string; original: string; targetFileId?: string; targetPath?: string; kind?: 'file' | 'directory'; uri?: boolean; state: 'internal' | 'external' | 'missing' }
export interface EditorState {
  templateUses?:{id:string;templateId:string;version:number;snapshotFileId:string;appliedAt:string;parameters:Record<string,string|number>;overrides:Record<string,string|number>;outputs:string[]}[];
  notices?: { fileId: string; message: string }[];
  buffers: Record<string, { text: string; baseHash: string }>;
  confirmations: Record<string, boolean>;
}
export interface Project {
  id: string; name: string; description: string; createdAt: string; modifiedAt: string; revision: number;
  snapshotId: string;
  targets: { app: TargetProfile; master: TargetProfile };
  entrypoints: EntryPoints;
  files: ProjectFile[];
  modules?: ModuleSnapshot[];
  archiveMetadata?: Record<string, any>;
  references: FileReference[];
  packageMap: Record<string, string>;
  editor: EditorState;
}
export interface Diagnostic {
  code: string; severity: 'error' | 'warning' | 'info'; message: string; fileId?: string; field?: string;
  text?: import('./messages').MessageTemplate;
}
export interface BusSignal {
  uid: string; slaveId: number; direction: 'input' | 'output'; sourceName: string; runtimeName: string;
  bitLength: number; bitOffset?: number; storageBytes: number; index?: number; subIndex?: number;
  dataType?: string; resolution: 'resolved' | 'ambiguous' | 'unresolved';
}
export interface BusSlave { id: number; name: string; address?: number; vendor?: string; product?: string }
export interface BusCatalog { masterId?: number; cycleUs?: number; slaves: BusSlave[]; signals: BusSignal[]; diagnostics: Diagnostic[] }
export const utf8 = new TextEncoder();
export const textOf = (file: ProjectFile) => new TextDecoder(file.encoding || 'utf-8', { fatal: true }).decode(file.bytes);
export const fileById = (p: Project, id: string | null | undefined) => p.files.find(f => f.id === id);
export const roleFile = (p: Project, role: FileRole) => p.files.find(f => f.role === role);
export const uid = () => crypto.randomUUID();
export async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), b => b.toString(16).padStart(2, '0')).join('');
}
