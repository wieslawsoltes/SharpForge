// Loopback-only browser qualification server. Its derived test tokens are not a deployment authentication policy.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createBrowserCsp } from '../../packages/network/src/index.js';
import { CollabRoomServer } from '../../packages/git/src/collab/room-server.js';
import { attachCollaborationWebSocketServer } from '../../packages/git/collab-server/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imports = {};
for (const name of await readdir(resolve(root, 'packages'))) {
  try {
    const metadata = JSON.parse(await readFile(resolve(root, 'packages', name, 'package.json'), 'utf8'));
    imports[metadata.name] = '/packages/' + name + '/src/index.js';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const nonce = randomBytes(18).toString('base64');
const authority = new CollabRoomServer({ authorize: ({ token, identity }) => {
  const expected = 'test-only:' + JSON.stringify([identity.workspaceId, identity.roomId, identity.documentId, identity.clientId]);
  if (token !== expected) throw new Error('Wrong browser fixture room token');
  return { identity, permissions: { read: true, write: true } };
} });
let adapter;
let base;
const rejectOffline = (request, socket) => socket.destroy();
const server = createServer((request, response) => {
  serve(request, response).catch(() => { response.writeHead(500); response.end('Fixture request failed'); });
});

async function serve(request, response) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/control/offline' && request.method === 'POST') {
    adapter?.dispose();
    adapter = null;
    server.on('upgrade', rejectOffline);
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname === '/control/online' && request.method === 'POST') {
    server.off('upgrade', rejectOffline);
    adapter ??= attachCollaborationWebSocketServer(server, { authority, allowedOrigins: [base] });
    response.writeHead(204);
    response.end();
    return;
  }
  const policy = createBrowserCsp([base.replace('http:', 'ws:')])
    .replace(/script-src ([^;]+)/u, (_, sources) => `script-src ${sources} 'nonce-${nonce}'`);
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/test.html') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Collaboration qualification</title>'
      + '<link rel="stylesheet" href="/packages/git/styles/collaboration.css">'
      + '<link rel="stylesheet" href="/packages/editor/src/editor.css">'
      + '<link rel="stylesheet" href="/packages/git/styles/editor.css">'
      + '<link rel="stylesheet" href="/tests/fixtures/a25-collab-browser.css"><body>'
      + '<h1>Live collaboration</h1><div id="source-editor" aria-label="Source editor"></div>'
      + '<div id="presence"></div><p id="announcements" role="status"></p>'
      + '<script type="importmap" nonce="' + nonce + '">' + JSON.stringify({ imports }) + '</script>'
      + '<script type="module" src="/tests/fixtures/a25-collab-browser.js"></script></body></html>');
    return;
  }
  const permitted = pathname.startsWith('/packages/') || /^\/apps\/studio\/git-collab-[a-z-]+\.js$/.test(pathname)
    || ['/apps/studio/git-editor-cursors.js', '/apps/studio/git-editor-geometry.js', '/apps/studio/git-dom.js',
      '/apps/studio/services/documents.js', '/apps/studio/services/edits.js', '/apps/studio/services/document-owner.js',
      '/tests/fixtures/a25-collab-browser.js', '/tests/fixtures/a25-collab-browser.css'].includes(pathname);
  const path = resolve(root, '.' + decodeURIComponent(pathname));
  const local = relative(root, path);
  const extension = extname(path);
  if (!permitted || local === '..' || local.startsWith('..' + sep) || !['.js', '.css', '.json'].includes(extension)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const bytes = await readFile(path);
    response.setHeader('Content-Type', extension === '.css' ? 'text/css' : extension === '.json' ? 'application/json' : 'text/javascript');
    response.end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    response.writeHead(404);
    response.end();
  }
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = 'http://127.0.0.1:' + server.address().port;
adapter = attachCollaborationWebSocketServer(server, { authority, allowedOrigins: [base] });
// Optional environment evidence must not prevent the actual browser scenario from starting.
const networkMetadata = { networkInterfaces: null, networkInterfaceDiagnostics: { source: 'node:os.networkInterfaces' } };
const systemFailure = error => ({ code: error?.code ?? null,
  syscall: error?.syscall ?? error?.info?.syscall ?? null, errno: error?.errno ?? error?.info?.errno ?? null });
try {
  networkMetadata.networkInterfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? []).map(({ family, internal }) => ({ name, family, internal })));
} catch (error) {
  networkMetadata.networkInterfaceDiagnostics.error = systemFailure(error);
  if (process.platform === 'linux') {
    try {
      const devices = await readFile('/proc/net/dev', 'utf8');
      networkMetadata.networkInterfaceDiagnostics.observedNames = { source: '/proc/net/dev',
        names: devices.split('\n').slice(2).flatMap(line => {
          const match = /^\s*([^:]+):/u.exec(line);
          return match ? [match[1].trim()] : [];
        }) };
    } catch (fallbackError) {
      networkMetadata.networkInterfaceDiagnostics.observedNames = { source: '/proc/net/dev', error: systemFailure(fallbackError) };
    }
  }
}
process.stdout.write(JSON.stringify({ url: base, node: process.version, ...networkMetadata }) + '\n');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  adapter?.dispose();
  await authority.dispose();
  server.close();
}
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
