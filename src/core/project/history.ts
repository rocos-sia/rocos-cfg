import type { Project } from './types';

/** Deduplicate only equal file contents after an isolated transaction has run.
 * The transaction still receives a deep clone, so in-place byte edits and
 * exceptions cannot mutate the current state or an older undo snapshot.
 */
export function shareUnchangedFileBytes(before: Project, after: Project) {
  const previous = new Map(before.files.map(file => [file.id, file.bytes]));
  for (const file of after.files) {
    const bytes = previous.get(file.id);
    if (!bytes || bytes.length !== file.bytes.length || bytes === file.bytes) continue;
    let same = true;
    for (let index = 0; index < bytes.length; index++) if (bytes[index] !== file.bytes[index]) { same = false; break; }
    if (same) file.bytes = bytes;
  }
}
