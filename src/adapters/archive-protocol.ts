import type { ArchiveInspection } from '../core/project/archive';
import type { ProjectRecovery } from '../core/project/recover';
import type { Project, Diagnostic } from '../core/project/types';
import type { ProjectAnalysis } from '../core/project/analysis';
import type { RuntimePlan } from '../core/export';

export interface RuntimePreview {
  bytes:Uint8Array;
  plan:Omit<RuntimePlan,'files'>&{files:{path:string}[]};
}

export interface ArchiveTasks {
  save:{input:{project:Project;version:string};output:Uint8Array};
  inspect:{input:{bytes:Uint8Array};output:ArchiveInspection};
  recover:{input:{bytes:Uint8Array;version:string};output:ProjectRecovery};
  analyze:{input:{project:Project;workspaceEpoch:number};output:ProjectAnalysis};
  validate:{input:{project:Project};output:Diagnostic[]};
  runtimeDirectory:{input:{project:Project};output:{diagnostics:Diagnostic[];prepared?:{plan:RuntimePlan}}};
  runtime:{input:{project:Project};output:{diagnostics:Diagnostic[];prepared?:RuntimePreview}};
}
export type ArchiveRequest = {[K in keyof ArchiveTasks]:{kind:K}&ArchiveTasks[K]['input']}[keyof ArchiveTasks];
export type ArchiveResponse =
  | {type:'progress';percent:number}
  | {type:'result';result:ArchiveTasks[keyof ArchiveTasks]['output']}
  | {type:'error';message:string;text?:import('../core/project/messages').MessageTemplate};
