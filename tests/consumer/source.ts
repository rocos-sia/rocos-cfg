import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** An unrelated descendant commit is allowed only when every attested input is unchanged. */
export function verifySourceBaseline(root: string, baseline: string, paths: string[]) {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const baseRevision = git('rev-parse', `${baseline}^{commit}`).toString().trim();
  if (spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', baseRevision, revision]).status !== 0) throw Error('Source is not a descendant of the attested baseline');
  if (git('status', '--porcelain', '--', ...paths).toString().trim()) throw Error('Attested source files have local modifications');
  const files = paths.map(path => {
    const local = resolve(root, path);
    if (!lstatSync(local).isFile()) throw Error(`Attested source is not a regular file: ${path}`);
    const bytes = readFileSync(local), expected = git('show', `${baseRevision}:${path}`);
    if (!bytes.equals(expected)) throw Error(`Source differs from attested baseline: ${path}`);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  return { baseline: baseRevision, revision, files };
}
