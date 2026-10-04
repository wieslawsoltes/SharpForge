import { readFile, lstat } from 'node:fs/promises';
import { MSBUILD_PROTOCOL_VERSION, BUILD_ACTIONS } from './contract.js';
import { readNativeJson, sendNativeJson } from './http-json.js';

async function readBinary({ workspace }, response, url) {
  const file = await workspace.path(url.searchParams.get('path'));
  const info = await lstat(file);
  if (!info.isFile() || info.size > workspace.maxArtifactBytes) throw new Error('File size limit exceeded');
  const bytes = await readFile(file);
  if (bytes.length > workspace.maxArtifactBytes) throw new Error('File size limit exceeded');
  response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  response.end(bytes);
}

async function withWorkspaceWrite(state, action, message, details = {}) {
  const { checkStarting = true, ...errorDetails } = details;
  if (state.engine.active || (checkStarting && state.engine.starting) || state.saving) {
    throw Object.assign(new Error(message), { status: 409, ...errorDetails });
  }
  state.saving = true;
  try { return await action(); }
  finally { state.saving = false; }
}

async function invokeService(state, scope, operation, input, signal) {
  if (scope === 'vfs' && operation === 'request') return invokeVfs(state, input, signal);
  const invoke = () => state.services.registry.invoke(scope, operation, input, { signal });
  if (scope !== 'nuget' || !['change', 'consolidate'].includes(operation)) return invoke();
  return withWorkspaceWrite(state, invoke, 'Stop native builds before changing package inputs', { checkStarting: false });
}

async function invokeVfs(state, input, signal) {
  const invoke = () => state.services.registry.invoke('vfs', 'request', input, { signal });
  if (!['writeFile', 'createDirectory', 'rename', 'delete'].includes(input.method)) return invoke();
  return withWorkspaceWrite(state, invoke, 'Stop the native operation before changing workspace files', {
    code: 'Conflict', path: input.payload?.path ?? input.payload?.from ?? ''
  });
}

async function readCapabilities(state) {
  const { engine, workspace, services } = state;
  state.capabilities ??= engine.probe().catch(error => ({ available: false, error: error.message }));
  return { protocolVersion: MSBUILD_PROTOCOL_VERSION, engine: engine.engine, executable: engine.executable,
    trusted: engine.trusted, root: workspace.root, actions: BUILD_ACTIONS,
    ...await state.capabilities, toolchains: await services.discover() };
}

function workspaceRoutes(state) {
  const { workspace, engine } = state;
  const routes = new Map([
    ['GET /capabilities', () => readCapabilities(state)],
    ['GET /workspace', () => workspace.scan()],
    ['GET /file', (_request, url) => workspace.read(url.searchParams.get('path'))],
    ['GET /item', (_request, url) => workspace.inspectItem(url.searchParams.get('path'))],
    ['POST /files', request => withWorkspaceWrite(state,
      async () => workspace.save((await readNativeJson(request)).changes),
      'Stop the native operation before saving project inputs')],
    ['POST /vfs', async (request, _url, signal) => invokeVfs(state, await readNativeJson(request), signal)],
    ['POST /jobs', async request => {
      if (state.saving) throw Object.assign(new Error('A disk save is in progress'), { status: 409 });
      return engine.start(await readNativeJson(request));
    }]
  ]);
  for (const path of ['/mutations', '/undo-mutation']) {
    routes.set('POST ' + path, request => withWorkspaceWrite(state, async () => {
      const input = await readNativeJson(request);
      return path === '/mutations' ? workspace.mutate(input.operations) : workspace.undoMutation(input.token);
    }, 'Stop the native operation before changing workspace files'));
  }
  return routes;
}

async function readBinlog(state, response, url, id, signal) {
  const options = Object.fromEntries(url.searchParams);
  for (const key of ['after', 'limit', 'offset', 'maxScanned', 'maxBytes']) {
    if (options[key] !== undefined) options[key] = Number(options[key]);
  }
  const value = await state.services.registry.invoke('binlog', 'query', { ...options, jobId: id }, { signal });
  sendNativeJson(response, 200, value);
}

async function jobRoute(state, request, response, url, path, signal) {
  const binlog = /^\/jobs\/([a-f0-9-]{36})\/binlog$/.exec(path);
  if (request.method === 'GET' && binlog) {
    await readBinlog(state, response, url, binlog[1], signal);
    return true;
  }
  const match = /^\/jobs\/([a-f0-9-]{36})(?:\/(cancel|artifact))?$/.exec(path);
  if (!match) return false;
  const [, id, action] = match;
  if (request.method === 'GET' && !action) {
    const after = url.searchParams.get('after') ?? '0';
    if (!/^\d+$/.test(after)) throw new Error('Invalid log cursor');
    sendNativeJson(response, 200, state.engine.snapshot(id, Number(after)));
    return true;
  }
  if (request.method === 'POST' && action === 'cancel') {
    await readNativeJson(request);
    sendNativeJson(response, 200, state.engine.cancel(id));
    return true;
  }
  if (request.method === 'GET' && action === 'artifact') {
    const name = url.searchParams.get('path');
    const bytes = await state.engine.artifact(id, name);
    response.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name.split('/').at(-1))}` });
    response.end(bytes);
    return true;
  }
  return false;
}

/** Compose authenticated native routes; the caller owns Host/origin/token verification before invoking this handler. */
export function createNativeApiHandler({ engine, workspace, services }) {
  const state = { engine, workspace, services, saving: false, capabilities: null };
  const routes = workspaceRoutes(state);
  return async (request, response, url, signal) => {
    const path = url.pathname.replace(/^\/api\/msbuild/, '');
    const route = routes.get(request.method + ' ' + path);
    if (route) {
      const value = await route(request, url, signal);
      sendNativeJson(response, path === '/jobs' ? 202 : 200, value);
      return;
    }
    if (request.method === 'GET' && path === '/binary') return readBinary(state, response, url);
    const service = /^\/services\/([a-z-]+)\/([a-z-]+)$/.exec(path);
    if (request.method === 'POST' && service) {
      const value = await invokeService(state, service[1], service[2], await readNativeJson(request), signal);
      sendNativeJson(response, 200, value);
      return;
    }
    if (await jobRoute(state, request, response, url, path, signal)) return;
    throw Object.assign(new Error('Unknown MSBuild API route'), { status: 404 });
  };
}
