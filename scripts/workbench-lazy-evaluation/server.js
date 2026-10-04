import {createServer} from 'node:http';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {overlayAssets, requireEntryPolicy} from './protocol.js';
import {sha256} from '../conformance/build-identity.js';
import {connectOrigins} from '../conformance/security/csp.js';

async function boundedBody(response, maximum) {
  const chunks = [];
  let bytes = 0;
  if (!response.body) throw new Error('Missing HTTP response body');
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maximum) throw new Error('Response exceeds overlay limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** A local fixture overlays four fixed resources; every product asset is streamed unchanged from the production server. */
export async function evaluationServer(productionUrl) {
  const base = new URL(productionUrl);
  if (base.pathname !== '/' || base.search || base.hash) throw new Error('Lazy evaluation requires a production root URL');
  const response = await fetch(new URL('index.html', base), {signal: AbortSignal.timeout(15000), redirect: 'error'});
  const policy = response.headers.get('content-security-policy');
  if (!response.ok) throw new Error('Production HTTP precondition failed');
  requireEntryPolicy(policy, connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS));
  const html = (await boundedBody(response, 1024 * 1024)).toString('utf8');
  const assets = overlayAssets(html), byPath = new Map(assets.map(asset => [asset.path, asset]));
  const failures = [], pending = new Set();
  let cancellations = 0;
  const server = createServer((incoming, outgoing) => {
    const location = new URL(incoming.url, 'http://127.0.0.1');
    const asset = byPath.get(location.pathname);
    if (incoming.method !== 'GET' || location.search) {
      outgoing.writeHead(400).end('Unsupported benchmark request');
      return;
    }
    if (asset) {
      outgoing.writeHead(200, {'content-type': asset.type, 'content-security-policy': policy,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'});
      outgoing.end(asset.body);
      return;
    }
    const target = new URL(base);
    target.pathname = location.pathname;
    let cancelled = false;
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {method: 'GET'}, upstream => {
      outgoing.writeHead(upstream.statusCode, upstream.headers);
      upstream.once('error', error => request.destroy(error));
      upstream.pipe(outgoing);
    });
    pending.add(request);
    request.setTimeout(30000, () => request.destroy(new Error('Production proxy request timed out')));
    request.once('error', error => {
      if (cancelled) return;
      failures.push({path: location.pathname, message: error.message});
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    request.once('close', () => pending.delete(request));
    outgoing.once('close', () => {
      if (outgoing.writableFinished) return;
      cancelled = true;
      cancellations++;
      request.destroy();
    });
    request.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {url: `http://127.0.0.1:${server.address().port}/`, assets, failures, get cancellations() { return cancellations; },
    async stop() {
      for (const request of pending) request.destroy();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }};
}

/** Record actual overlay response hashes outside measurement, in addition to ordinary production-asset verification. */
export async function verifyOverlays(server, signal) {
  const rows = [];
  for (const asset of server.assets) {
    const response = await fetch(new URL(asset.path, server.url), {signal, redirect: 'error', cache: 'no-store'});
    const body = await boundedBody(response, asset.bytes);
    const row = {path: asset.path, bytes: body.length, sha256: sha256(body)};
    rows.push(row);
    if (!response.ok || row.bytes !== asset.bytes || row.sha256 !== asset.sha256) throw new Error('Overlay identity mismatch');
  }
  return rows;
}
