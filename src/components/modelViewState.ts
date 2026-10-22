import type { PreviewPose } from './previewPose';
import { createModelLayoutState } from './modelLayout';

export type GeometryMode = 'visual' | 'collision';
interface PoseSnapshot extends PreviewPose { projectId: string; fileId: string }
export function createPreviewState() {
  return {
    pose: { current: undefined as PoseSnapshot | undefined }, touched: { current: false }, joint: '',
    camera: undefined as { position: number[]; target: number[]; far: number } | undefined,
    display: { visual: true, collision: false, axes: true, jointAxes: true, grid: true, translucent: false },
  };
}
export interface StructureViewState {
  topology: string; expanded?: string[]; filtered?: { query: string; keys: string[] }; scrollTop: number;
}
/** One workspace session only: never serialized into .rcproj or recovery data. */
export function createModelViewState() {
  return { preview: createPreviewState(), selected: '', search: '', tree: { topology: '', scrollTop: 0 } as StructureViewState, layout: createModelLayoutState() };
}
export type ModelViewState = ReturnType<typeof createModelViewState>;
