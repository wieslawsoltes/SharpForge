import {PortableTestAdapter} from '@sharpforge/msbuild';

const fail = error => ({name: error.name ?? 'Error', message: error.message ?? String(error), code: error.code});

/** Worker-owned discovery and managed sessions never run compiler or VM work on the Studio UI thread. */
export function createTestWorkerService({postMessage, adapter = new PortableTestAdapter()} = {}) {
  const operations = new Map();
  let discovery = null;
  let compilationOptions = {};
  let revision = 0;
  let closed = false;

  async function discover(params, signal) {
    if (!Array.isArray(params.sources) || params.sources.length > 20000) throw new Error('Invalid portable test source set');
    let characters = 0;
    for (const source of params.sources) {
      if (typeof source.uri !== 'string' || typeof source.text !== 'string' || (characters += source.text.length) > 32 * 1024 * 1024) {
        throw new Error('Portable test source limit exceeded');
      }
    }
    const options = params.compilationOptions ?? {};
    discovery = await adapter.discover(params.sources, {project: params.project, backend: params.backend, signal,
      compileOptions: options, languageVersion: options.langVersion,
      preprocessorSymbols: options.preprocessorSymbols ?? options.defines,
      maxTests: 10000, evaluateData: params.evaluateData !== false});
    compilationOptions = options;
    return {tests: discovery.tests, diagnostics: discovery.diagnostics, backend: params.backend ?? 'source', discoveryId: ++revision};
  }

  async function run(params, signal, requestId) {
    if (!discovery || params.discoveryId !== revision) throw new Error('Portable discovery changed; discover tests again');
    const ids = new Set(params.testIds ?? discovery.tests.map(test => test.id));
    const known = new Set(discovery.tests.map(test => test.id));
    if (!ids.size || ids.size > 10000 || [...ids].some(id => !known.has(id))) {
      throw new Error('Select tests from the current discovery');
    }
    const selected = {...discovery, tests: discovery.tests.filter(test => ids.has(test.id))};
    return adapter.run(selected, {signal, backend: params.backend, timeoutMs: params.timeoutMs, compileOptions: compilationOptions,
      includeExplicit: true, onSession: session => postMessage({event: 'session', requestId, session}),
      onEvent: value => postMessage({event: 'progress', requestId, value})});
  }

  async function receive(message) {
    const {id, method, params = {}} = message ?? {};
    if (method === 'cancel') { operations.get(params.requestId)?.abort(); return; }
    if (method === 'close') { close(); return; }
    if (closed) return postMessage({id, error: fail(new Error('Test worker is disposed'))});
    if (!Number.isSafeInteger(id) || operations.has(id) || !['discover', 'run'].includes(method)) {
      return postMessage({id, error: fail(new Error('Invalid test worker request'))});
    }
    if (operations.size) return postMessage({id, error: fail(new Error('Finish the active portable test operation first'))});
    const controller = new AbortController();
    operations.set(id, controller);
    try {
      const result = method === 'discover' ? await discover(params, controller.signal) : await run(params, controller.signal, id);
      postMessage({id, result});
    } catch (error) { postMessage({id, error: fail(error)}); }
    finally { operations.delete(id); }
  }

  function close() {
    closed = true;
    for (const controller of operations.values()) controller.abort();
    adapter.close();
    discovery = null;
  }
  return {receive, close};
}
