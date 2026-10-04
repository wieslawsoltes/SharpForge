import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBrowserCsp } from '../packages/network/src/index.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function rewritePackageAliases(source) {
  // Use the production build's package-entry rewrite; implementations stay unchanged.
  return source.replace(/(['"])@sharpforge\/([\w-]+)\1/gu, (_, quote, name) => `${quote}/packages/${name}/src/index.js${quote}`);
}

/** Serve only A25 fixtures, their production Git views and source packages under the production CSP. */
export async function createGitStorageFixtureServer() {
  const root = await realpath(repository);
  const csp = createBrowserCsp();
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const fixture = /^\/tests\/a25-(?:storage-browser\.(?:html|js)|auth-browser\.js|ui-browser(?:-worker)?\.(?:html|js|css))$/u.test(path);
      const studio = path === '/apps/studio/themes.css'
        || /^\/apps\/studio\/(?:git-[a-z-]+\.js|styles\/[a-z-]+\.css)$/u.test(path);
      if (!(path.startsWith('/packages/') || fixture || studio)) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const absolute = await realpath(resolve(root, `.${path}`));
      const local = relative(root, absolute);
      if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || local.split(sep).includes('.git')) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const extension = extname(absolute);
      let body = await readFile(absolute);
      if (extension === '.js' || extension === '.mjs') body = Buffer.from(rewritePackageAliases(body.toString('utf8')));
      if (extension === '.html') {
        body = Buffer.from(body.toString('utf8').replace(/<script type="importmap">[\s\S]*?<\/script>/u, ''));
      }
      response.writeHead(200, { 'Content-Type': mime[extension] ?? 'application/octet-stream',
        'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': csp });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Fixture server failed');
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}`, csp };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  createGitStorageFixtureServer().then(({ server, origin, csp }) => {
    process.stdout.write(`${JSON.stringify({ origin, csp })}\n`);
    const close = () => server.close();
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }).catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
