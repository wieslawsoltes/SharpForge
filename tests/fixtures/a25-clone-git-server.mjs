import { createServer } from 'node:https';
import { request as requestHttp } from 'node:http';
import { readFile } from 'node:fs/promises';
import { startGitHttpFixture } from '../../packages/git/bench/git-http-fixture.js';

const fixtureToken = 'sharpforge-local-clone-fixture-only';
const maximumBytes = 16 * 1024 * 1024;
const allowedHeaders = new Set(['authorization', 'content-type', 'git-protocol']);
const endpoint = /^\/(public|private)\.git\/(?:info\/refs|git-upload-pack)$/u;

function forward(request, response, backend, row, pending) {
  const headers = { ...request.headers };
  // Authentication terminates at the fixture's TLS boundary. No token crosses the plaintext upstream hop.
  for (const name of ['authorization', 'cookie', 'origin', 'host', 'connection']) delete headers[name];
  const upstream = requestHttp(new URL(request.url, backend), { method: request.method, headers }, received => {
    row.contentType = received.headers['content-type'] ?? '';
    response.writeHead(received.statusCode, received.headers);
    received.on('data', bytes => {
      row.responseBytes += bytes.length;
      if (row.responseBytes > maximumBytes) fail('response-limit');
    });
    received.on('error', () => fail('upstream-response'));
    received.pipe(response);
  });
  pending.add(upstream);
  const fail = reason => { row.error = reason; upstream.destroy(); response.destroy(); };
  const timer = setTimeout(() => fail('deadline'), 60000);
  const cleanup = () => { clearTimeout(timer); pending.delete(upstream); };
  upstream.on('error', () => { cleanup(); response.destroy(); });
  request.on('data', bytes => {
    row.requestBytes += bytes.length;
    if (row.requestBytes > maximumBytes) fail('request-limit');
  });
  request.on('aborted', () => fail('aborted'));
  response.on('close', () => { cleanup(); if (!response.writableEnded) upstream.destroy(); });
  response.on('finish', cleanup);
  request.pipe(upstream);
}

/** Real native Git bytes behind an explicit, test-only HTTPS authentication and CORS boundary. */
export async function startCloneGitServer({ directory, env, cert, key }) {
  const backend = await startGitHttpFixture({ directory, env, maxRequestBytes: maximumBytes, maxResponseBytes: maximumBytes });
  const pending = new Set();
  const observations = [];
  const diagnostics = [];
  let allowedOrigin;
  let server;
  function handle(request, response) {
    const url = new URL(request.url, 'https://127.0.0.1');
    const row = { sequence: observations.length, path: url.pathname, method: request.method,
      origin: request.headers.origin ?? '', authorizationPresent: !!request.headers.authorization,
      authenticated: false, forwarded: false, requestBytes: 0, responseBytes: 0, status: null };
    if (observations.length >= 256) { response.writeHead(429); response.end(); return; }
    observations.push(row);
    response.setHeader('X-SharpForge-Fixture-Sequence', String(row.sequence));
    response.on('finish', () => { row.status = response.statusCode; });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Origin');
    if (!endpoint.test(url.pathname) || request.headers.origin !== allowedOrigin || !allowedOrigin) {
      response.writeHead(403); response.end(); return;
    }
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', [...allowedHeaders].join(', '));
    response.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      const names = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(name => name.trim());
      const accepted = ['GET', 'POST'].includes(request.headers['access-control-request-method'])
        && names.every(name => !name || allowedHeaders.has(name));
      response.writeHead(accepted ? 204 : 403); response.end(); return;
    }
    if (!['GET', 'POST'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (url.pathname.startsWith('/private.git/')) {
      row.authenticated = request.headers.authorization === `Bearer ${fixtureToken}`;
      if (!row.authenticated) {
        response.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="SharpForge local clone fixture"' });
        response.end('Authentication required'); return;
      }
    }
    row.forwarded = true;
    forward(request, response, backend.origin, row, pending);
  }
  try {
    server = createServer({ cert: await readFile(cert), key: await readFile(key) }, handle);
    server.on('tlsClientError', error => {
      if (diagnostics.length < 40) diagnostics.push({ phase: 'tls-handshake', code: error.code ?? 'TLS_HANDSHAKE_FAILED' });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return {
      origin: `https://127.0.0.1:${server.address().port}`,
      allowOrigin(value) {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.href !== `${url.origin}/`) {
          throw new Error('The clone browser fixture requires one exact loopback Studio origin');
        }
        allowedOrigin = url.origin;
      },
      observations: () => observations.map(row => ({ ...row })),
      diagnostics: () => diagnostics.map(row => ({ ...row })),
      async close() {
        for (const request of pending) request.destroy();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await backend.close();
      }
    };
  } catch (error) {
    server?.close();
    await backend.close();
    throw error;
  }
}
