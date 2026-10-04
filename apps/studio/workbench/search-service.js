import {WorkbenchEvents, abortError, cancellable} from './events.js';
import {compileFileGlobs, searchDocuments} from './search-engine.js';
import {boundedDocuments} from './document-size.js';
import {workerRequest} from './worker-request.js';

export class SearchService extends WorkbenchEvents {
  constructor({documents, context = () => ({}), applyEdits, createWorker, sessionProject, timeoutMs = 5000} = {}) {
    super();
    this.documents = documents;
    this.context = context;
    this.applyEdits = applyEdits;
    this.sessionProject = sessionProject;
    this.createWorker = createWorker ?? (globalThis.Worker ? () => new Worker(
      new URL('./search.worker.js', import.meta.url), {type: 'module'}) : null);
    this.timeoutMs = timeoutMs;
    this.results = new Map();
    this.queries = new Map();
    this.serial = 0;
    this.disposed = false;
  }
  files(scope, globs) {
    const context = this.context();
    const matches = compileFileGlobs(globs);
    scope = ({'current-project': 'project', 'current-document': 'document', 'open-documents': 'open'})[scope] ?? scope;
    const projectId = scope?.startsWith('project:') ? scope.slice(8) :
      scope?.startsWith('session:') ? this.sessionProject?.(scope.slice(8)) : context.projectId;
    const projectScope = scope === 'project' || scope?.startsWith('project:') || scope?.startsWith('session:');
    if (projectScope && !projectId) throw new Error('The selected scope has no available project');
    const records = this.documents.list().filter(document => matches(document.uri) &&
      (scope === 'solution' || !scope || scope === 'document' && document.uri === context.uri ||
        scope === 'open' && context.openUris?.includes(document.uri) || projectScope &&
        (document.projectId === projectId || this.documents.projectsFor?.(document.uri)?.includes(projectId))));
    return boundedDocuments(this.documents, records);
  }
  async run(query, options = {}) {
    if (this.disposed) throw abortError('Search service is disposed');
    options.signal?.throwIfAborted();
    const instance = options.instance ?? 'find-results-1';
    if (this.results.get(instance)?.locked && !options.keepResults) throw new Error('This result window is locked; use Keep Results');
    const target = options.keepResults ? instance + '-' + ++this.serial : instance;
    this.queries.get(target)?.abort();
    const controller = new AbortController();
    this.queries.set(target, controller);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, {once: true});
    options.signal?.throwIfAborted();
    try {
      const documents = this.files(options.scope, options.globs ?? '*');
      const result = await this.search(documents, query, options, controller.signal);
      controller.signal.throwIfAborted();
      if (this.queries.get(target) !== controller) throw abortError('Search superseded');
      const snapshot = {id: target, query, options: {...options, signal: undefined}, ...result, locked: false};
      if (!this.results.has(target) && this.results.size >= 20) {
        const oldest = [...this.results.values()].find(result => !result.locked);
        if (!oldest) throw new Error('All 20 search result windows are locked; unlock one before keeping another result');
        this.results.delete(oldest.id);
      }
      this.results.set(target, snapshot);
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
    return workerRequest({documents, query, options: {...options, signal: undefined, onProgress: undefined}},
      {createWorker: this.createWorker, signal, timeoutMs: this.timeoutMs, onProgress: options.onProgress});
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
  dispose() {
    this.disposed = true;
    for (const controller of this.queries.values()) controller.abort();
    this.results.clear();
    super.dispose();
  }
}

export class WorkspaceSymbolIndex {
  constructor({request, documents}) {
    this.request = request; this.documents = documents; this.generation = 0; this.disposed = false;
    this.events = new WorkbenchEvents();
    this.unsubscribe = documents.subscribe?.(event => {
      if (!['changed', 'added', 'reset', 'membership'].includes(event.type)) return;
      this.generation++;
      this.events.emit(event);
    });
  }
  subscribe(listener) { return this.events.subscribe(listener); }
  async query(query, {signal, onBatch = () => {}} = {}) {
    const generation = ++this.generation;
    const result = [];
    for (const document of this.documents.list()) {
      signal?.throwIfAborted();
      const version = document.version;
      const symbols = await cancellable(this.request('symbols', {uri: document.uri, version}, {signal}), signal);
      if (this.disposed || generation !== this.generation) throw abortError('Symbol query superseded');
      if (this.documents.get(document.uri)?.version !== version) continue;
      const batch = symbols.filter(symbol => fuzzyMatch(symbol.name, query)).map(symbol => ({...symbol,
        uri: document.uri, version, projectId: symbol.projectId ?? document.projectId ?? this.documents.projectsFor?.(document.uri)?.[0]}));
      result.push(...batch);
      onBatch(batch);
      if (result.length >= 20000) return result.slice(0, 20000);
    }
    return result;
  }
  dispose() { this.disposed = true; this.generation++; this.unsubscribe?.(); this.events.dispose(); }
}

export function fuzzyMatch(value, query) {
  if (!query) return true;
  const lower = value.toLowerCase(), target = query.toLowerCase();
  if (lower.includes(target)) return true;
  const initials = value.replace(/[^A-Z0-9]/g, '').toLowerCase();
  return initials.includes(target);
}
