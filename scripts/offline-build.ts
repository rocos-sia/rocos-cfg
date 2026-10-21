import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { Plugin } from 'vite';

// Enumerate the finished output, including public assets and lazy chunks. An
// installation succeeds only after every required application resource is cached.
export function offlineBuild(): Plugin {
  let output: string;
  return {
    name: 'rocos-offline-shell',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const paths: string[] = [];
      async function walk(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) await walk(path);
          else if (entry.name !== 'sw.js') paths.push(relative(output, path).replaceAll('\\', '/'));
        }
      }
      await walk(output);
      paths.sort();
      const hash = createHash('sha256');
      for (const path of paths) hash.update(path).update(await readFile(resolve(output, path)));
      const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
      await writeFile(resolve(output, 'sw.js'), template
        .replace('__BUILD_ID__', JSON.stringify(hash.digest('hex')))
        .replace('__ASSETS__', JSON.stringify(paths)));
    },
  };
}
