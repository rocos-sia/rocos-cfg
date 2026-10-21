import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { resolve } from 'node:path';
const entries = Object.create(null);
async function walk(dir, prefix) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path, name + '/');
    else entries[name] = new Uint8Array(await readFile(path));
  }
}
await walk('dist', 'rocos-configurator/dist/');
const version = (await readFile('VERSION', 'utf8')).trim();
entries['rocos-configurator/VERSION'] = strToU8(version + '\n');
entries['rocos-configurator/scripts/serve-static.mjs'] = new Uint8Array(await readFile('scripts/serve-static.mjs'));
entries['rocos-configurator/LICENSE'] = new Uint8Array(await readFile('LICENSE'));
entries['rocos-configurator/启动说明.txt'] = strToU8(`ROCOS Configurator 静态离线包\n\n1. 将压缩包完整解压。\n2. 使用已安装的 Node.js 22.12+，在解压目录执行：\n   node scripts/serve-static.mjs\n3. 浏览器打开 http://127.0.0.1:4173/\n\n启动不需要 npm install，也不访问公网。服务只监听本机。\n也可在 dist 目录使用预装 Python 3 执行：\n   python3 -m http.server 4173 --bind 127.0.0.1\n请勿通过 file:// 直接打开 index.html。\n关闭终端会停止本机服务。工程文件请单独下载 .rcproj 留存。\n本包不包含 Node.js、Python 或浏览器；首次离线使用前请准备其中一种运行时和浏览器。\n`);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/rocos-configurator-offline.zip', zipSync(entries, { level: 6 }));
console.log('Created artifacts/rocos-configurator-offline.zip');
