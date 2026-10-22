import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySourceBaseline } from './source';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'rocos-source-proof-')); roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'user.name=Contract test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet'); writeFileSync(join(root, 'loader.cpp'), 'int value = 1;\n'); git('add', '.'); git('commit', '--quiet', '-m', 'baseline');
  return { root, git, baseline: git('rev-parse', 'HEAD') };
}
it('allows a documentation-only descendant while retaining the exact baseline and input hashes', () => {
  const { root, git, baseline } = repository(); writeFileSync(join(root, 'README.md'), 'new documentation'); git('add', '.'); git('commit', '--quiet', '-m', 'docs');
  const proof = verifySourceBaseline(root, baseline, ['loader.cpp']);
  expect(proof.baseline).toBe(baseline); expect(proof.revision).not.toBe(baseline); expect(proof.files[0].sha256).toHaveLength(64);
});
it('rejects committed changes to an attested loader', () => {
  const { root, git, baseline } = repository(); writeFileSync(join(root, 'loader.cpp'), 'int value = 2;\n'); git('add', '.'); git('commit', '--quiet', '-m', 'changed parser');
  expect(() => verifySourceBaseline(root, baseline, ['loader.cpp'])).toThrow('differs from attested baseline');
});
it('rejects dirty input and an unrelated history', () => {
  const { root, git, baseline } = repository(); writeFileSync(join(root, 'loader.cpp'), 'int value = 2;\n');
  expect(() => verifySourceBaseline(root, baseline, ['loader.cpp'])).toThrow('local modifications');
  git('checkout', '--', 'loader.cpp'); git('checkout', '--orphan', 'unrelated'); git('commit', '--quiet', '-m', 'other root');
  expect(() => verifySourceBaseline(root, baseline, ['loader.cpp'])).toThrow('not a descendant');
});
