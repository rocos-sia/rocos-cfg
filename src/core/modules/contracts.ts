import type { Diagnostic, FileRole, Project, ProjectFile } from '../project/types';
export interface ModuleReference { field: string; original: string; kind?: 'file' | 'directory'; uri?: boolean }
export interface ModuleContext { project: Project; file: ProjectFile }
export interface ModuleExportContext extends ModuleContext { path: string; rewrites: { field: string; value: string }[] }
export interface ModuleOutput { path: string; bytes: Uint8Array; fileId?: string }
export interface ConfigModule<T = any> {
  id: string; version: number; role: FileRole; syntax?: 'yaml' | 'xml' | 'text';
  capabilities: { readonly: boolean; generate: boolean; advancedEdit: boolean; desktop: boolean };
  detect(file: ProjectFile): boolean;
  parse(file: ProjectFile): T;
  validate(value: T, context: ModuleContext): Diagnostic[];
  references(value: T, context: ModuleContext): ModuleReference[];
  export(value: T, context: ModuleExportContext): ModuleOutput[];
}
