import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { digest, uid, utf8 } from '../src/core/project/types';
import { createProject } from '../src/core/project/create';
import { openProject, saveProject } from '../src/core/project/archive';
import { newRecoveryKey } from '../src/adapters/recovery';
import { packZip, unpackZip } from '../src/core/project/zip';

const native = globalThis.crypto;
const httpCrypto = () => vi.stubGlobal('crypto', { getRandomValues: native.getRandomValues.bind(native) });
afterEach(() => vi.unstubAllGlobals());

it('keeps native SHA-256 output and uses the same algorithm without SubtleCrypto', async () => {
  const fixtures = [new Uint8Array(), utf8.encode('abc'), utf8.encode('中文配置 🚀'), new Uint8Array(1000000).fill(0x61),
    Uint8Array.from({ length: 257 }, (_, i) => i & 255).subarray(1, 256)];
  const expected = fixtures.map(bytes => createHash('sha256').update(bytes).digest('hex'));
  expect(expected[0]).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(await Promise.all(fixtures.map(digest))).toEqual(expected);
  httpCrypto();
  expect(await Promise.all(fixtures.map(digest))).toEqual(expected);
});

it('creates unique UUID v4 identifiers and recovery keys without randomUUID', () => {
  httpCrypto();
  const ids = Array.from({ length: 100 }, uid);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(newRecoveryKey()).toMatch(/^rocos-recovery-session:[0-9a-f-]{36}$/);
});

it('saves HTTP-created projects that reopen with native crypto and still detects tampered bytes', async () => {
  httpCrypto();
  const project = createProject('HTTP roundtrip', 'igh'), archive = await saveProject(project);
  const http = await openProject(archive);
  expect(http.entrypoints).toEqual(project.entrypoints);
  vi.unstubAllGlobals();
  const secure = await openProject(archive);
  expect(secure.id).toBe(project.id);
  expect(await digest(archive)).toBe(createHash('sha256').update(archive).digest('hex'));
  const nativeArchive = await saveProject(secure);
  httpCrypto();
  expect((await openProject(nativeArchive)).id).toBe(project.id);
  const changed = unpackZip(archive), path = project.files.find(file => file.id === project.entrypoints.master.fileId)!.path;
  changed.get(path)![0] ^= 1;
  await expect(openProject(packZip(changed))).rejects.toThrow('SHA-256');
});
