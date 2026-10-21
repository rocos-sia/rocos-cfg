#!/usr/bin/env node
// Dependency-free loopback server for the prebuilt offline distribution.
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = await realpath(resolve(argument('--dir', fileURLToPath(new URL('../dist', import.meta.url)))));
const base = argument('--base', '/');
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) throw new Error('base must be / or /repository/');
const port = Number(argument('--port', '4173'));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.ttf':'font/ttf', '.wasm':'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === base.slice(0, -1)) { res.writeHead(308, { Location:base }).end(); return; }
    if (!pathname.startsWith(base) || pathname.includes('\\') || pathname.includes('\0')) { res.writeHead(404).end(); return; }
    const local = pathname.slice(base.length) || 'index.html';
    const file = await realpath(resolve(root, local));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`ROCOS Configurator: http://127.0.0.1:${server.address().port}${base}\n`));
