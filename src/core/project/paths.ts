export function safePath(path: string): string {
  if (!path || path.startsWith('/') || /[\\:\x00-\x1f]/.test(path)) throw new Error(`非法工程路径：${path}`);
  if (path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`非法工程路径：${path}`);
  return path;
}
export function checkPaths(paths: string[]) {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = safePath(path).normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`重复或大小写冲突的文件：${path}`);
    // A regular file cannot also be an ancestor directory.
    if ([...seen].some(p => p.startsWith(key + '/') || key.startsWith(p + '/'))) throw new Error(`文件与目录冲突：${path}`);
    seen.add(key);
  }
}
export function resolvePath(sourcePath: string, reference: string, packageMap: Record<string, string> = {}): string | undefined {
  let input = reference;
  let base = sourcePath.split('/').slice(0, -1);
  if (input.startsWith('package://')) {
    const [pkg, ...rest] = input.slice(10).split('/');
    if (!Object.hasOwn(packageMap, pkg)) return undefined;
    input = packageMap[pkg] + '/' + rest.join('/'); base = [];
  } else if (/^(?:[a-z]+:|\/|\\)/i.test(input)) return undefined;
  if (input.includes('\\') || input.includes('\0')) return undefined;
  for (const part of input.split('/')) {
    if (part === '..') { if (!base.length) return undefined; base.pop(); }
    else if (part && part !== '.') base.push(part);
  }
  return base.join('/');
}

export function relativePath(source: string, target: string): string {
  safePath(source); safePath(target);
  const from = source.split('/').slice(0, -1), to = target.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/') || '.';
}
export function resourcePath(source: string, reference: string, packages: Record<string, string>, uri = false) {
  let path = reference;
  if (uri) { try { path = decodeURIComponent(path); } catch { return undefined; } }
  const resolved = resolvePath(source, path, packages);
  if (resolved === undefined) return undefined;
  try { return safePath(resolved); } catch { return undefined; }
}
