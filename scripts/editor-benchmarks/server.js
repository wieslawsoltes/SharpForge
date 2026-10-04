import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { rootDirectory } from './common.js';

/** Loopback-only static harness server with an exact import-map CSP hash and no eval or third-party scripts. */
export async function createBenchmarkServer(root = rootDirectory) {
  root = resolve(root);
  const imports = {};
  const packages = await readdir(resolve(root, 'packages'), { withFileTypes: true });
  for (const entry of packages) {
    if (!entry.isDirectory()) continue;
    try {
      const definition = JSON.parse(await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8'));
      if (definition.name?.startsWith('@sharpforge/')) imports[definition.name] = `/packages/${entry.name}/src/index.js`;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const map = JSON.stringify({ imports }).replaceAll('<', '\\u003c');
  const hash = createHash('sha256').update(map).digest('base64');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Editor latency benchmark</title>
<link rel="stylesheet" href="/packages/editor/src/editor.css"><link rel="stylesheet" href="/scripts/editor-benchmarks/browser.css">
<script type="importmap">${map}</script></head><body><main id="editor"></main>
<script type="module" src="/scripts/editor-benchmarks/browser-harness.js"></script></body></html>`;
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };
  const server = createServer(async (request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end('Malformed benchmark resource URL'); return; }
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'sha256-${hash}'; style-src 'self'; worker-src 'self' blob:`);
    if (pathname === '/__editor_benchmark__') { response.setHeader('Content-Type', 'text/html'); response.end(page); return; }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`) || !types[extname(path)]) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(path);
      response.setHeader('Content-Type', types[extname(path)]);
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/__editor_benchmark__`;
  return { url, close: () => new Promise(resolve => server.close(resolve)) };
}
