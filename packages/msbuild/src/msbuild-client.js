import { MSBUILD_PROTOCOL_VERSION, normalizeBuildRequest } from './contract.js';

/** Same-origin client. Credentials remain in memory, never localStorage or query strings. */
export class MSBuildClient {
  constructor({ token, fetch: fetcher = globalThis.fetch, base = '/api/msbuild' } = {}) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('A local MSBuild session token is required');
    if (typeof fetcher !== 'function' || !/^\/api\/[a-z/-]+$/i.test(base)) throw new Error('Invalid MSBuild endpoint');
    this.token = token;
    this.fetcher = fetcher;
    this.base = base;
  }

  static fromLocation(location = globalThis.location, history = globalThis.history) {
    const params = new URLSearchParams(location?.hash?.slice(1) ?? '');
    const token = params.get('sharpforge-token');
    if (!token) return null;
    params.delete('sharpforge-token');
    history?.replaceState?.(null, '', location.pathname + location.search + (params.size ? '#' + params.toString() : ''));
    return new MSBuildClient({ token });
  }

  async request(path, { method = 'GET', body, signal, binary = false } = {}) {
    const response = await this.fetcher(this.base + path, {
      method,
      headers: { Authorization: 'Bearer ' + this.token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal, cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) {
      let error;
      try { error = await response.json(); } catch {}
      const failure = new Error(error?.error ?? `Local MSBuild request failed (${response.status})`);
      failure.status = response.status;
      failure.code = error?.code;
      failure.path = error?.path;
      failure.diagnostics = error?.diagnostics;
      failure.written = error?.written;
      failure.completed = error?.completed;
      failure.undoToken = error?.undoToken;
      throw failure;
    }
    return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
  }

  async connect() {
    const result = await this.request('/capabilities');
    if (result.protocolVersion !== MSBUILD_PROTOCOL_VERSION) throw new Error('Incompatible local MSBuild host version');
    return result;
  }

  workspace() { return this.request('/workspace'); }
  read(path) { return this.request('/file?path=' + encodeURIComponent(path)); }
  inspectItem(path) { return this.request('/item?path=' + encodeURIComponent(path)); }
  binary(path) { return this.request('/binary?path=' + encodeURIComponent(path), { binary: true }); }
  mutate(operations) { return this.request('/mutations', { method: 'POST', body: { operations } }); }
  undoMutation(token) { return this.request('/undo-mutation', { method: 'POST', body: { token } }); }
  save(changes) { return this.request('/files', { method: 'POST', body: { changes } }); }
  start(request) { return this.request('/jobs', { method: 'POST', body: normalizeBuildRequest(request) }); }
  job(id, after = 0) { return this.request('/jobs/' + encodeURIComponent(id) + '?after=' + after); }
  cancel(id) { return this.request('/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} }); }

  artifact(id, path) {
    return this.request('/jobs/' + encodeURIComponent(id) + '/artifact?path=' + encodeURIComponent(path), { binary: true });
  }

  service(scope, operation, request, options = {}) {
    if (!/^[a-z-]+$/.test(scope) || !/^[a-z-]+$/.test(operation)) throw new Error('Invalid service name');
    return this.request('/services/' + scope + '/' + operation, { method: 'POST', body: request, signal: options.signal });
  }

  vfs(method, payload, options = {}) {
    return this.request('/vfs', { method: 'POST', body: { method, payload }, signal: options.signal });
  }

  projectContext(request, options) { return this.service('project', 'context', request, options); }
  projectContexts(request, options) { return this.service('project', 'contexts', request, options); }
  projectMetadata(request, options) { return this.service('project', 'metadata', request, options); }

  runProject(request, options) { return this.service('project', 'run', request, options); }
  publishProfiles(request, options) { return this.service('publish', 'profiles', request, options); }
  publishProfile(request, options) { return this.service('publish', 'execute', request, options); }

  sdkInventory(options) { return this.service('sdk', 'inventory', {}, options); }
  resolveSdk(request, options) { return this.service('sdk', 'resolve', request, options); }
  workloads(request, options) { return this.service('sdk', 'workloads', request, options); }
  disconnect() { this.token = ''; }
}
