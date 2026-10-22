import { child, children } from '../core/documents/xml';
import type { MessageInput } from '../core/project/messages';
import type { GeometryMode } from './modelViewState';

export interface GeometryOwner { link: string; mode: GeometryMode }
export interface PreviewResourceProblem {
  sourceId: string; uri: string; kind: 'mesh' | 'texture'; reason: MessageInput; owners: GeometryOwner[];
}
/** Only standard Link geometry participates; legacy <hardware> stays opaque. */
export function previewMeshReferences(document: Document) {
  const result: { uri: string; owner: GeometryOwner }[] = [];
  for (const link of children(document.documentElement, 'link')) {
    for (const [tag, mode] of [['visual', 'visual'], ['collision', 'collision']] as const) {
      for (const group of children(link, tag)) {
        const geometry = child(group, 'geometry'), mesh = geometry && child(geometry, 'mesh');
        if (mesh) result.push({ uri: mesh.getAttribute('filename') || '', owner: { link: link.getAttribute('name') || '', mode } });
      }
    }
  }
  return result;
}
export function uniqueOwners(owners: GeometryOwner[]) {
  return [...new Map(owners.map(owner => [JSON.stringify([owner.link, owner.mode]), owner])).values()];
}
