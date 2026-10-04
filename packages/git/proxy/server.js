import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const allowedHeaders = ['accept', 'authorization', 'content-type', 'git-protocol'];

function targetFrom(request, options) {
  const incoming = new URL(request.url, 'http://localhost');
  if (incoming.pathname !== (options.path ?? '/git') || [...incoming.searchParams.keys()].some(key => key !== 'url')) return null;
  const targetValue = incoming.searchParams.get('url');
  if (!targetValue) return null;
  let target;
  try { target = new URL(targetValue); }
  catch { return null; }
  if (target.username || target.password || target.hash || target.pathname.includes('\\')) return null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (target.protocol !== 'https:' && !(options.allowInsecureLocalhost && local && target.protocol === 'http:')) return null;
  if (!options.upstreamOrigins.has(target.origin)) return null;
  let pathname;
  try { pathname = decodeURIComponent(target.pathname); }
  catch { return null; }
  if (pathname.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git')) return null;
  if (pathname.includes('\\') || /[\x00-\x20\x7f]/.test(pathname)) return null;
  if (request.method === 'GET' && pathname.endsWith('/info/refs')) {
    const service = target.searchParams.get('service');
    if (!['git-upload-pack', 'git-receive-pack'].includes(service) || [...target.searchParams.keys()].some(key => key !== 'service')) return null;
    return target;
  }
  if (request.method === 'POST' && !target.search && /\/(?:git-upload-pack|git-receive-pack)$/.test(pathname)) return target;
  return null;
}

function cors(request, response, options) {
  const origin = request.headers.origin;
  if (!origin || !options.clientOrigins.has(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Retry-After');
  return true;
}

/** A local/self-hosted allow-list proxy. It never evaluates hooks, logs credentials or follows redirects. */
export function createGitProxy({ upstreamOrigins = [], clientOrigins = [], fetch: fetchImpl = globalThis.fetch,
  maxRequestBytes = 256 * 1024 * 1024, maxResponseBytes = 4 * 1024 ** 3, timeoutMs = 120_000, ...rest } = {}) {
  const options = { ...rest, upstreamOrigins: new Set(upstreamOrigins), clientOrigins: new Set(clientOrigins) };
  return createServer(async (request, response) => {
    if (!cors(request, response, options)) { response.writeHead(403); response.end('Origin is not allowed'); return; }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!['GET', 'POST'].includes(method) || headers.some(header => !allowedHeaders.includes(header))) {
        response.writeHead(403); response.end('Preflight is not allowed'); return;
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      response.writeHead(204); response.end(); return;
    }
    const target = targetFrom(request, options);
    if (!target) { response.writeHead(403); response.end('Git target is not allowed'); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    request.once('aborted', abort);
    try {
      const headers = new Headers();
      for (const name of allowedHeaders) if (request.headers[name]) headers.set(name, request.headers[name]);
      const body = request.method === 'POST' ? boundedBody(request, maxRequestBytes, controller.signal) : undefined;
      const upstream = await fetchImpl(target.href, {
        method: request.method, headers, body, duplex: 'half', signal: controller.signal, redirect: 'error', credentials: 'omit'
      });
      const contentType = upstream.headers.get('content-type');
      if (contentType) response.setHeader('Content-Type', contentType);
      const retry = upstream.headers.get('retry-after');
      if (retry) response.setHeader('Retry-After', retry);
      response.writeHead(upstream.status);
      if (upstream.body) await pipeline(Readable.from(boundedBody(upstream.body, maxResponseBytes, controller.signal)), response);
      else response.end();
    } catch (error) {
      if (!response.headersSent) { response.writeHead(error.code === 'PROXY_LIMIT' ? 413 : 502); response.end('Git proxy request failed'); }
      else response.destroy();
    } finally {
      clearTimeout(timer);
      request.removeListener('aborted', abort);
    }
  });
}

async function* boundedBody(stream, maximum, signal) {
  let total = 0;
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('Proxy transfer cancelled');
    total += chunk.length;
    if (total > maximum) {
      const error = new Error('Proxy transfer exceeded its configured size limit');
      error.code = 'PROXY_LIMIT';
      throw error;
    }
    yield chunk;
  }
}
