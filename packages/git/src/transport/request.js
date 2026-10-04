import { GitError, checkCancelled } from '../errors.js';

/** Invoke the explicit transport. Runtime modules never fall back to ambient fetch. */
export async function gitRequest(transport, request) {
  checkCancelled(request.signal);
  const invoke = typeof transport === 'function' ? transport : transport?.request?.bind(transport);
  if (!invoke) throw new GitError('Network', 'A Git HTTP transport is required');
  const response = await invoke(request);
  const status = response.status ?? 200;
  if (status < 200 || status >= 300) {
    const code = [401, 403].includes(status) ? 'Auth' : status === 404 ? 'NotFound' : status === 409 ? 'Conflict' : 'Network';
    const error = new GitError(code, 'Git HTTP request failed', { status, origin: new URL(request.url).origin });
    // Rejected response bodies are never consumed by protocol parsers; release their stream and deadline here.
    try { await response.body?.cancel?.(error); }
    catch { /* A cleanup failure must not replace the remote status diagnostic. */ }
    throw error;
  }
  return response;
}

export function gitServiceUrl(url, service, discovery = false) {
  const target = new URL(url);
  if (target.username || target.password || target.hash || target.search) throw new GitError('Unsafe', 'Git repository URL contains credentials or suffixes');
  target.pathname = target.pathname.replace(/\/$/, '') + (discovery ? '/info/refs' : `/${service}`);
  if (discovery) target.searchParams.set('service', service);
  return target.href;
}
