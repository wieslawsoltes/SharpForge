import { WorkbenchEvents, abortError, assertId } from './events.js';
import { documentSize } from './document-size.js';

const COMMAND = 'sharpforge.tests.run';
const MAX_TESTS = 100000;
const MAX_LENSES = 5000;
const STATE_TITLES = Object.freeze({
  'not-run': 'Not run', queued: 'Queued', running: 'Running', passed: 'Passed',
  failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled'
});

function failure(code, message) {
  const error = new Error(message);
  error.name = 'TestCodeLensError';
  error.code = code;
  return error;
}

function signals(params, options) {
  const values = [...new Set([params?.signal, options?.signal].filter(Boolean))];
  for (const signal of values) {
    if (typeof signal.throwIfAborted !== 'function' || typeof signal.addEventListener !== 'function') {
      throw new TypeError('Test CodeLens cancellation requires an AbortSignal');
    }
    signal.throwIfAborted();
  }
  return values;
}

function sourceVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function testLocation(test) {
  return typeof test.uri === 'string' && test.uri.length > 0 && test.uri.length <= 512 &&
    Number.isSafeInteger(test.start) && test.start >= 0 && Number.isSafeInteger(test.end) && test.end >= test.start;
}

function unresolved(entry) {
  return { uri: entry.uri, start: entry.start, end: entry.end,
    data: { provider: 'tests', testId: entry.id, version: entry.version, projectId: entry.projectId } };
}

class TestCodeLens extends WorkbenchEvents {
  constructor({ tests, getDocument, projectIdsForUri, execute } = {}) {
    super();
    if (!(tests?.tests instanceof Map) || !(tests.providers instanceof Map) || typeof tests.subscribe !== 'function' ||
        typeof tests.run !== 'function' || typeof getDocument !== 'function' || typeof projectIdsForUri !== 'function') {
      throw new TypeError('Test CodeLens requires TestProviders and current document/project lookups');
    }
    if (execute !== undefined && typeof execute !== 'function') throw new TypeError('Test execution wrapper must be a function');
    this.tests = tests;
    this.getDocument = getDocument;
    this.projectIdsForUri = projectIdsForUri;
    this.execute = execute;
    this.byId = new Map();
    this.byUri = new Map();
    this.running = new Set();
    this.disposed = false;
    this.index();
    this.unsubscribe = tests.subscribe(event => this.changed(event));
  }

  owners(uri) {
    const values = this.projectIdsForUri(uri);
    if (!Array.isArray(values) && !(values instanceof Set)) throw new TypeError('Document project IDs must be an array or Set');
    if (values.size > 10000 || values.length > 10000) throw new RangeError('Document project ownership limit exceeded');
    return [...new Set([...values].map(value => assertId(value, 'Project ID')))];
  }

  index() {
    if (this.tests.tests.size > MAX_TESTS) throw new RangeError('Test CodeLens discovery limit exceeded');
    this.byId.clear();
    this.byUri.clear();
    const documents = new Map();
    for (const [id, test] of this.tests.tests) {
      if (!testLocation(test) || typeof id !== 'string' || id.length > 512 || !test.providerId) continue;
      if (!documents.has(test.uri)) documents.set(test.uri, { record: this.getDocument(test.uri), owners: this.owners(test.uri) });
      const { record, owners } = documents.get(test.uri);
      const projectId = test.projectId ?? (owners.length === 1 ? owners[0] : null);
      const version = test.version ?? record?.version;
      if (!projectId || !owners.includes(projectId) || !sourceVersion(version) || record?.uri !== test.uri) continue;
      const entry = { id, test, uri: test.uri, start: test.start, end: test.end, projectId, version,
        explicitProject: test.projectId !== undefined, providerId: test.providerId };
      this.byId.set(id, entry);
      const entries = this.byUri.get(test.uri) ?? [];
      entries.push(entry);
      this.byUri.set(test.uri, entries);
    }
    for (const entries of this.byUri.values()) entries.sort((left, right) =>
      left.start - right.start || left.end - right.end || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  changed(event) {
    if (event.type === 'discovered') this.index();
    if (event.type === 'provider-removed') {
      for (const [id, entry] of this.byId) if (entry.providerId === event.id) this.byId.delete(id);
      for (const [uri, entries] of this.byUri) {
        const retained = entries.filter(entry => entry.providerId !== event.id);
        if (retained.length) this.byUri.set(uri, retained);
        else this.byUri.delete(uri);
      }
    }
    if (event.type === 'test-state') {
      const entry = this.byId.get(event.test?.id);
      if (!entry || this.tests.tests.get(entry.id) !== event.test) return;
      this.emit({ type: 'changed', reason: event.type, uri: entry.uri, testId: entry.id, projectId: entry.projectId });
    } else if (['discovered', 'provider', 'provider-removed', 'run-ended'].includes(event.type)) {
      this.emit({ type: 'changed', reason: event.type });
    }
  }

  request(params, options) {
    if (this.disposed) throw failure('SFTEST1001', 'Test CodeLens provider is disposed');
    signals(params, options);
    const uri = assertId(params?.uri, 'Document URI');
    if (!sourceVersion(params.version)) throw failure('SFTEST1002', 'Test CodeLens requires an exact source version');
    const record = this.getDocument(uri);
    if (!record || record.uri !== uri) throw failure('SFTEST1002', 'Test CodeLens document is missing or has a different URI');
    if (record.version !== params.version) throw failure('SFTEST1002', 'Test CodeLens source is stale');
    const owners = this.owners(uri);
    if (!owners.length || (params.projectId !== undefined && !owners.includes(params.projectId))) {
      throw failure('SFTEST1003', 'Test CodeLens document has no matching project owner');
    }
    return { uri, version: params.version, length: documentSize({}, record), owners, projectId: params.projectId };
  }

  current(entry, request) {
    if (!entry || this.tests.tests.get(entry.id) !== entry.test || !this.tests.providers.has(entry.providerId)) return false;
    if (entry.uri !== request.uri || entry.version !== request.version || !request.owners.includes(entry.projectId)) return false;
    if (request.projectId !== undefined && entry.projectId !== request.projectId) return false;
    if (!entry.explicitProject && (request.owners.length !== 1 || request.owners[0] !== entry.projectId)) return false;
    const test = entry.test;
    if (test.uri !== entry.uri || test.start !== entry.start || test.end !== entry.end ||
        (test.version !== undefined && test.version !== entry.version) ||
        (test.projectId !== undefined && test.projectId !== entry.projectId)) return false;
    return request.length === null || entry.end <= request.length;
  }

  codeLens(params, options) {
    const request = this.request(params, options);
    const entries = this.byUri.get(request.uri) ?? [];
    const items = [];
    for (const entry of entries) {
      if (!this.current(entry, request)) continue;
      if (items.length >= MAX_LENSES) throw failure('SFTEST1004', 'Test CodeLens limit of 5000 per document exceeded');
      items.push(unresolved(entry));
    }
    return { uri: request.uri, version: request.version, items };
  }

  resolveCodeLens(params, options) {
    const request = this.request(params, options);
    const lens = params.lens;
    const data = lens?.data;
    const entry = this.byId.get(data?.testId);
    if (data?.provider !== 'tests' || data.version !== request.version || data.projectId !== entry?.projectId ||
        lens.uri !== request.uri || lens.start !== entry?.start || lens.end !== entry?.end || !this.current(entry, request)) {
      throw failure('SFTEST1005', 'Test CodeLens location, discovery or project ownership is stale');
    }
    const state = STATE_TITLES[entry.test.state];
    if (!state) throw failure('SFTEST1006', 'Test provider reported an unknown state');
    const name = String(entry.test.name).replace(/[\u0000-\u001f]/gu, ' ').slice(0, 160);
    const duration = entry.test.duration;
    const timing = Number.isFinite(duration) && duration >= 0 ? ` (${Number(duration.toFixed(2))} ms)` : '';
    return { ...unresolved(entry), command: { title: `${state} · ${name}${timing}`, command: COMMAND,
      arguments: [{ testId: entry.id, uri: entry.uri, version: entry.version, projectId: entry.projectId }] } };
  }

  commandEntry(params, options) {
    const request = this.request(params, options);
    const args = params.arguments;
    if (params.command !== COMMAND || !Array.isArray(args) || args.length !== 1) {
      throw failure('SFTEST1007', 'Unsupported Test CodeLens command');
    }
    const argument = args[0];
    const entry = this.byId.get(argument?.testId);
    if (!argument || argument.uri !== request.uri || argument.version !== request.version ||
        argument.projectId !== entry?.projectId || !this.current(entry, request)) {
      throw failure('SFTEST1005', 'Test CodeLens command source, test or project ownership is stale');
    }
    return entry;
  }

  async executeCommand(params, options) {
    const entry = this.commandEntry(params, options);
    if (this.running.size >= 64) throw failure('SFTEST1004', 'Test CodeLens concurrent execution limit exceeded');
    const controller = new AbortController();
    const cleanups = [];
    const forward = signal => {
      signal.throwIfAborted();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', abort));
    };
    let started = false;
    let active = true;
    let completion;
    const run = (runOptions = {}) => {
      if (!active || started) throw failure('SFTEST1007', 'A Test CodeLens operation can start only once');
      if (this.commandEntry(params, { signal: controller.signal }) !== entry) {
        throw failure('SFTEST1005', 'Test discovery changed before execution');
      }
      if (runOptions.signal) forward(runOptions.signal);
      started = true;
      completion = this.tests.run([entry.id], { signal: controller.signal });
      return completion;
    };
    this.running.add(controller);
    try {
      for (const signal of signals(params, options)) forward(signal);
      const operation = { testIds: [entry.id], uri: entry.uri, version: entry.version,
        projectId: entry.projectId, signal: controller.signal, run };
      const result = this.execute ? await this.execute(operation) : await run();
      if (!started) throw failure('SFTEST1007', 'Test execution wrapper did not invoke the registered test provider');
      await completion;
      return result;
    } catch (error) {
      controller.abort(error);
      // Observe the registry's terminal cancellation before rethrowing the initiating failure.
      if (completion) await completion.then(() => {}, () => {});
      throw error;
    } finally {
      active = false;
      this.running.delete(controller);
      for (const cleanup of cleanups) cleanup();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const controller of this.running) controller.abort(abortError('Test CodeLens disposed'));
    this.running.clear();
    this.byId.clear();
    this.byUri.clear();
    super.dispose();
  }
}

/**
 * Connect discovered, source-versioned tests to lazy editor CodeLens methods.
 * Lookups are synchronous; execution is cancellable and uses the registered TestProviders instance.
 * Missing/stale requests throw SFTEST1001–1007. Unlocated or stale discoveries have no clickable lens.
 */
export function createTestCodeLensProvider(options) {
  const provider = new TestCodeLens(options);
  return {
    codeLens: (params, options) => provider.codeLens(params, options),
    resolveCodeLens: (params, options) => provider.resolveCodeLens(params, options),
    executeCommand: (params, options) => provider.executeCommand(params, options),
    subscribe: listener => provider.subscribe(listener),
    dispose: () => provider.dispose()
  };
}
