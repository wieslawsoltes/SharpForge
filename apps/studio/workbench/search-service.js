import {WorkbenchEvents, abortError, cancellable} from './events.js';
import {compileFileGlobs, searchDocuments} from './search-engine.js';

export class SearchService extends WorkbenchEvents {
  constructor({documents, context = () => ({}), applyEdits, createWorker, timeoutMs = 5000} = {}) {
    super();
    this.documents = documents;
    this.context = context;
    this.applyEdits = applyEdits;
    this.createWorker = createWorker ?? (globalThis.Worker ? () => new Worker(
      new URL('./search.worker.js', import.meta.url), {type: 'module'}) : null);
    this.timeoutMs = timeoutMs;
    this.results = new Map();
    this.queries = new Map();
    this.serial = 0;
  }
  files(scope, globs) {
    const context = this.context();
    const matches = compileFileGlobs(globs);
    return this.documents.list().filter(document => matches(document.uri) &&
      (scope === 'solution' || !scope || scope === 'document' && document.uri === context.uri ||
        scope === 'open' && context.openUris?.includes(document.uri) || scope === 'project' && document.projectId === context.projectId))
      .map(document => ({uri: document.uri, text: document.text, version: document.version, projectId: document.projectId}));
  }
  async run(query, options = {}) {
    const instance = options.instance ?? 'find-results-1';
    if (this.results.get(instance)?.locked && !options.keepResults) throw new Error('This result window is locked; use Keep Results');
    const target = options.keepResults ? instance + '-' + ++this.serial : instance;
    this.queries.get(target)?.abort();
    const controller = new AbortController();
    this.queries.set(target, controller);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, {once: true});
    options.signal?.throwIfAborted();
    const documents = this.files(options.scope, options.globs ?? '*');
    try {
      const result = await this.search(documents, query, options, controller.signal);
      controller.signal.throwIfAborted();
      if (this.queries.get(target) !== controller) throw abortError('Search superseded');
      const snapshot = {id: target, query, options: {...options, signal: undefined}, ...result, locked: false};
      this.results.set(target, snapshot);
      while (this.results.size > 20) this.results.delete(this.results.keys().next().value);
      this.emit({type: 'results', result: snapshot});
      return snapshot;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (this.queries.get(target) === controller) this.queries.delete(target);
    }
  }
  search(documents, query, options, signal) {
    if (!this.createWorker) {
      if (options.regex) throw new Error('Regex workspace search requires a worker so it can be interrupted safely');
      return this.searchInline(documents, query, options, signal);
    }
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); };
      const fail = error => { cleanup(); reject(error); };
      const abort = () => fail(signal.reason ?? abortError());
      const timer = setTimeout(() => fail(new Error('Workspace search exceeded ' + this.timeoutMs + ' ms and was stopped')), this.timeoutMs);
      signal.addEventListener('abort', abort, {once: true});
      worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'progress') { options.onProgress?.(message.progress); return; }
        if (message.type === 'error') { fail(Object.assign(new Error(message.error.message), {name: message.error.name})); return; }
        if (message.type === 'result') { cleanup(); resolve(message.result); }
      };
      worker.onerror = event => fail(new Error(event.message ?? 'Search worker failed'));
      worker.postMessage({documents, query, options: {...options, signal: undefined, onProgress: undefined}});
    });
  }
  async searchInline(documents, query, options, signal) {
    const matches = [];
    let scannedFiles = 0;
    for (const document of documents) {
      signal.throwIfAborted();
      const result = searchDocuments([document], query, {...options, maxMatches: Math.min(10000, 100000 - matches.length)});
      matches.push(...result.matches);
      scannedFiles++;
      if (result.truncated || matches.length === 100000) return {matches, scannedFiles, truncated: true};
      options.onProgress?.({scannedFiles, matches: matches.length});
      if (scannedFiles % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {matches, scannedFiles, truncated: false};
  }
  async replace(resultId, selectedIds) {
    const result = this.results.get(resultId);
    if (!result) throw new Error('Unknown search results');
    const selected = new Set(selectedIds);
    const groups = new Map(), skipped = [];
    for (const match of result.matches) {
      if (!selected.has(match.id)) continue;
      const document = this.documents.get(match.uri);
      if (!document || document.version !== match.version) { skipped.push(match); continue; }
      if (match.replacement === undefined) throw new Error('Search must include a replacement preview');
      const edits = groups.get(match.uri) ?? [];
      edits.push({...match, newText: match.replacement});
      groups.set(match.uri, edits);
    }
    for (const [uri, edits] of groups) {
      const version = edits[0].version;
      if (this.documents.get(uri)?.version !== version) { skipped.push(...edits); groups.delete(uri); continue; }
      await this.applyEdits(edits, {label: 'Replace in Files', uri, version});
    }
    return {changedDocuments: [...groups.keys()], skipped};
  }
  cancel(instance) { this.queries.get(instance)?.abort(); }
  dispose() { for (const controller of this.queries.values()) controller.abort(); this.results.clear(); super.dispose(); }
}

export class WorkspaceSymbolIndex {
  constructor({request, documents}) { this.request = request; this.documents = documents; this.generation = 0; this.disposed = false; }
  async query(query, {signal, onBatch = () => {}} = {}) {
    const generation = ++this.generation;
    const result = [];
    for (const document of this.documents.list()) {
      signal?.throwIfAborted();
      const symbols = await cancellable(this.request('symbols', {uri: document.uri}, {signal}), signal);
      if (this.disposed || generation !== this.generation) throw abortError('Symbol query superseded');
      if (this.documents.get(document.uri)?.version !== document.version) continue;
      const batch = symbols.filter(symbol => fuzzyMatch(symbol.name, query)).map(symbol => ({...symbol,
        uri: document.uri, version: document.version, projectId: document.projectId}));
      result.push(...batch);
      onBatch(batch);
      if (result.length >= 20000) return result.slice(0, 20000);
    }
    return result;
  }
  dispose() { this.disposed = true; this.generation++; }
}

export function fuzzyMatch(value, query) {
  if (!query) return true;
  const lower = value.toLowerCase(), target = query.toLowerCase();
  if (lower.includes(target)) return true;
  const initials = value.replace(/[^A-Z0-9]/g, '').toLowerCase();
  return initials.includes(target);
}
