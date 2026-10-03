import { spawn } from 'node:child_process';

export class GitHubError extends Error {
  constructor(message, { status = 0, headers = {}, data, transient = false } = {}) {
    super(message); this.name = 'GitHubError'; Object.assign(this, { status, headers, data, transient });
    this.exitCode = transient ? 75 : 1;
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function withRetry(operation, { attempts = 5, baseMs = 500, maxMs = 30000, random = Math.random, wait = sleep, now = Date.now, retryAmbiguous = true } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('attempts must be 1..10');
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      const limited = error.status === 429 || (error.status === 403 && /rate limit|abuse|secondary/i.test(error.message));
      const retryable = limited || [500, 502, 503, 504].includes(error.status);
      if (!limited && !retryAmbiguous && (retryable || error.status === 0)) { error.ambiguous = true; error.transient = true; error.exitCode = 75; throw error; }
      if (!retryable) throw error;
      error.transient = true; error.exitCode = 75;
      if (attempt + 1 === attempts) throw error;
      const retryAfter = error.headers?.['retry-after'];
      const reset = error.headers?.['x-ratelimit-reset'];
      const serverMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now()) : reset ? Number(reset) * 1000 - now() : 0;
      // Do not retry earlier than GitHub asks; defer to a later invocation if its delay exceeds our budget.
      if (serverMs > maxMs) throw error;
      await wait(Math.min(maxMs, Math.max(0, serverMs || baseMs * 2 ** attempt) + random() * baseMs));
    }
  }
}
export function isReadOnlyRequest(request) {
  const method = (request.method ?? 'GET').toUpperCase();
  return ['GET', 'HEAD'].includes(method) || (method === 'POST' && request.path === 'graphql' && /^(?:query\b|\{)/.test((request.body?.query ?? '').replace(/^\s*(?:#[^\n]*\n\s*)*/, '').trimStart()));
}
export function ghTransport({ executable = 'gh', retry = {}, spawnProcess = spawn } = {}) {
  return request => withRetry(() => new Promise((resolve, reject) => {
    const args = ['api', '--include', '--method', request.method ?? 'GET', request.path, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (request.body !== undefined) args.push('--input', '-');
    const child = spawnProcess(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject);
    child.on('close', code => {
      const split = out.search(/\r?\n\r?\n/), header = split < 0 ? '' : out.slice(0, split);
      const raw = split < 0 ? out : out.slice(split).trim();
      let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      let status = Number(header.match(/HTTP\S*\s+(\d+)/)?.[1] ?? (code ? 0 : 200));
      const headers = Object.fromEntries(header.split(/\r?\n/).slice(1).filter(line => line.includes(':')).map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
      const message = data?.errors?.map(e => e.message).join('; ') || data?.message || err.trim() || `HTTP ${status}`;
      // A GraphQL mutation can return partial data with errors under HTTP 200.
      // Only a real rejected 403/429 response permits retrying that mutation.
      if (isReadOnlyRequest(request) && data?.errors?.some(e => e.type === 'RATE_LIMIT' || /rate limit|abuse|secondary/i.test(e.message))) status = 403;
      // gh exits nonzero for GraphQL errors even when HTTP is 200. Return permanent
      // GraphQL error payloads to the client so it can shrink resource-heavy queries.
      if ((code && !data?.errors) || status >= 400) reject(new GitHubError(message, { status, headers, data }));
      else resolve(data);
    });
    child.stdin.end(request.body === undefined ? undefined : JSON.stringify(request.body));
  }), {...retry, retryAmbiguous: isReadOnlyRequest(request)});
}
