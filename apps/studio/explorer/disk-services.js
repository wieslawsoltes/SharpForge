import {DocumentReloadCoordinator, FileWatchCoalescer, WorkspaceSearchIndex} from '@sharpforge/workspace';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {scanDirectory} from '@sharpforge/project-system';
import {DiskServicesView} from './disk-services-view.js';

const projectPath = /(?:\.(?:[a-z]*proj|props|targets|slnx?|slnf)|(?:^|\/)(?:global\.json|NuGet\.Config))$/i;
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

/** A transactional workspace host may already have evaluated the accepted project-file snapshot. */
export function diskReloadCallbacks(command) {
  return {
    applyChange: ({path, disk: record, event, expectedVersion}) =>
      command('disk-external-change', {path, record, event, expectedVersion}),
    onReevaluate: ({path, event, disk: record, application}) => application?.reevaluated ? application
      : command('disk-reevaluate', {path, event, record})
  };
}

/** Explorer lifecycle for byte-aware watching, dirty-buffer decisions, path search, and streamed Find in Files. */
export class ExplorerDiskServices {
  constructor(view) {
    this.view = view;
    this.disk = null;
    this.documents = new Map();
    this.dirty = new Set();
    this.generation = 0;
    this.queue = Promise.resolve();
    this.queuedEvents = 0;
    this.ui = new DiskServicesView(view, {
      choose: (path, choice) => this.run(() => this.choose(path, choice)),
      open: path => this.run(() => view.onOpen({path, kind: /\.(cs|vb|fs)$/i.test(path) ? 'source' : 'file'}))
    });
    this.searchInput = () => this.run(() => this.searchPaths(view.search.value));
    view.search.addEventListener('input', this.searchInput);
  }

  error(error, generation = this.generation) {
    if (generation !== this.generation || this.disposed || error.name === 'AbortError' || this.controller?.signal.aborted) return;
    this.ui.message(error.message);
    this.view.onError?.(error);
  }

  run(action) {
    const generation = this.generation;
    return Promise.resolve().then(action).catch(error => this.error(error, generation));
  }

  command(action, payload) {
    return Promise.resolve(this.view.onCommand(action, {path: payload.path ?? payload.event?.path}, [], payload)).then(result => {
      if (result?.error) throw new Error(result.error);
      return result;
    });
  }

  observe(data) {
    if (this.disposed) return;
    const disk = data.disk ?? null;
    const provider = data.provider ?? disk?.provider ?? null;
    if (disk !== this.disk || provider !== this.provider || !!data.native !== this.native) this.attach(disk, data);
    if (!disk || data.native) return;
    const records = data.records ?? data.files ?? disk.records;
    if (this.revision !== data.revision || this.records !== records) {
      this.revision = data.revision;
      this.records = records;
      const previous = this.documents;
      const dirty = new Set(data.dirty ?? []);
      this.documents = new Map(records.map(record => [record.path ?? record.uri, record]));
      const oldDirty = this.dirty;
      this.dirty = dirty;
      const generation = this.generation;
      this.indexReady = (this.indexReady ?? Promise.resolve()).then(() => this.syncIndex(previous, oldDirty, generation));
      this.indexReady.catch(error => this.error(error, generation));
    }
    this.watcher?.setWatchedPaths?.(data.tabs ?? [data.active].filter(Boolean));
    const outcomes = disk.importReport?.outcomes ?? disk.skipped ?? [];
    if (this.report !== outcomes || this.reportCount !== outcomes.length) {
      this.report = outcomes;
      this.reportCount = outcomes.length;
      this.ui.importReport(outcomes);
    }
  }

  attach(disk, data) {
    this.close();
    this.disk = disk;
    this.native = !!data.native;
    this.provider = data.provider ?? disk?.provider ?? null;
    this.revision = undefined;
    this.records = null;
    this.report = null;
    if (!disk || data.native) return;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const generation = this.generation;
    const provider = this.provider;
    const searchable = {
      check: (path, options) => provider.check(path, options),
      stat: (path, options) => provider.stat(path, options),
      readFile: async (path, options) => {
        const record = this.documents.get(path);
        return typeof record?.text === 'string' ? encodeWorkspaceFile(record) : provider.readFile(path, options);
      }
    };
    this.index = new WorkspaceSearchIndex(searchable, {onDiagnostic: diagnostic => {
      if (generation === this.generation) this.ui.message(diagnostic.message);
    }});
    this.findInFiles = async (query, options = {}) => {
      const request = new AbortController();
      const abort = () => request.abort();
      const signals = [signal, options.signal].filter(Boolean);
      for (const source of signals) {
        source.addEventListener('abort', abort, {once: true});
        if (source.aborted) abort();
      }
      try {
        await this.indexReady;
        if (request.signal.aborted) throw new DOMException('Workspace changed or search cancelled', 'AbortError');
        return await this.index.findInFiles(query, {...options, signal: request.signal});
      } finally { for (const source of signals) source.removeEventListener('abort', abort); }
    };
    this.previousFindInFiles = {owned: Object.hasOwn(disk, 'findInFiles'), value: disk.findInFiles};
    disk.findInFiles = this.findInFiles;
    this.reload = new DocumentReloadCoordinator({provider, getDocument: path => this.document(path), replaceDocument: () => {},
      ...diskReloadCallbacks((action, payload) => this.command(action, payload)), onPrompt: prompt => this.ui.prompt(prompt)});
    this.coalescer = new FileWatchCoalescer(event => {
      if (this.queuedEvents >= 10000) { this.rescanAfterQueue = true; return; }
      this.queuedEvents++;
      this.queue = this.queue.then(async () => {
        while (generation === this.generation && this.view.getData().fileBusy) await new Promise(resolve => setTimeout(resolve, 50));
        if (generation === this.generation) await this.onEvent(event);
      }).catch(error => this.error(error, generation)).finally(() => {
        this.queuedEvents--;
        if (!this.queuedEvents && this.rescanAfterQueue && generation === this.generation) {
          this.rescanAfterQueue = false;
          this.coalescer.push({type: 'rescan', path: ''});
        }
      });
    });
    this.unsubscribeSaves = disk.subscribeSaves?.(saved => {
      this.coalescer.markOwnWrite(saved.path, saved.hash);
      this.index.invalidate(saved.path);
    });
    if (disk.rootHandle || data.provider) {
      this.opening = provider.watch('', event => this.run(() => this.receive(event)), {signal,
        watchedPaths: data.tabs ?? [data.active].filter(Boolean)}).then(watcher => {
        if (generation !== this.generation) watcher.dispose();
        else { this.watcher = watcher; this.ui.message('Watching disk changes'); }
      }).catch(error => this.error(error, generation));
    }
  }

  document(path) {
    const record = this.documents.get(path);
    if (!record || typeof record.text !== 'string' && !this.dirty.has(path)) return null;
    return {...record, version: record.version ?? 0, dirty: this.dirty.has(path)};
  }

  async syncIndex(previous, oldDirty, generation) {
    if (generation !== this.generation) return;
    let count = 0;
    let yielded = performance.now();
    const index = this.index;
    for (const [path, record] of this.documents) {
      if (generation !== this.generation) return;
      const old = previous.get(path);
      if (!index.entries.has(path) || old?.size !== record.size || old?.version !== record.version) index.upsert(record);
      if (old?.text !== record.text || old?.bytes !== record.bytes || oldDirty.has(path) !== this.dirty.has(path)) index.invalidate(path);
      if (++count % 128 === 0 && performance.now() - yielded >= 8) { await nextTurn(); yielded = performance.now(); }
    }
    for (const path of index.entries.keys()) if (!this.documents.has(path)) index.remove(path);
  }

  async receive(event) {
    const signal = this.controller.signal;
    const generation = this.generation;
    if (event.hash === undefined && ['created', 'changed'].includes(event.type)) {
      try {
        const stat = await this.provider.stat(event.path, {signal, hash: true});
        event = {...event, kind: stat.type, hash: stat.hash};
      } catch (error) {
        if (error.code === 'NotFound') event = {...event, type: 'deleted'};
        else if (error.code !== 'FileTooLarge') throw error;
      }
    }
    if (generation === this.generation) this.coalescer.push(event);
  }

  async onEvent(event) {
    if (this.disposed || !this.disk) return;
    const generation = this.generation;
    const revision = this.revision;
    const provider = this.provider;
    const signal = this.controller.signal;
    const path = event.oldPath ?? event.path;
    if (event.hash && this.disk.baselineHashes.get(event.path) === event.hash) return;
    if (event.type === 'deleted' && !this.disk.record(path)
      && !this.disk.folderIndex?.has(this.provider.pathPolicy.identity(path))) return;
    if (event.type === 'rescan' || event.kind === 'directory' || this.disk.folderIndex?.has(this.provider.pathPolicy.identity(path))) {
      const scanned = await scanDirectory(provider, {...this.disk.options, signal});
      if (!this.#currentEvent(generation, revision, {type: 'rescan', path})) return;
      await this.command('disk-reevaluate', {path, event, rescan: true,
        records: scanned.records, folders: scanned.folders, report: scanned.report.summary()});
      return;
    }
    await this.index.onWatchEvent(event);
    if (!this.#currentEvent(generation, revision, event)) return;
    if (this.document(path) || projectPath.test(event.path)) {
      await this.reload.handle(event);
    } else {
      let record = null;
      if (event.type !== 'deleted') {
        const metadata = await provider.stat(event.path, {signal});
        if (!this.#currentEvent(generation, revision, event)) return;
        record = {path: event.path, size: metadata.size, lastModified: metadata.mtime, lazy: true};
      }
      await this.command('disk-external-change', {path, record, event});
    }
    if (generation === this.generation) this.ui.message('Disk change detected: ' + event.path);
  }

  #currentEvent(generation, revision, event) {
    if (generation !== this.generation || this.disposed) return false;
    if (revision === this.revision && !this.view.getData().fileBusy) return true;
    this.coalescer.push(event);
    return false;
  }

  async choose(path, choice) {
    const result = await this.reload.choose(path, choice);
    if (choice === 'compare') this.ui.compare(result);
    else { this.ui.removePrompt(path); this.ui.message(choice === 'keep' ? 'Kept your edits to ' + path : 'Reloaded ' + path); }
    return result;
  }

  async searchPaths(query) {
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    if (!this.index || !query) { this.ui.paths(''); return; }
    this.ui.paths(query, [], {loading: true});
    await this.indexReady;
    const matches = await this.index.searchPaths(query, {signal: controller.signal, limit: 101});
    if (!controller.signal.aborted) this.ui.paths(query, matches.slice(0, 100), {truncated: matches.length > 100});
  }

  close() {
    this.generation++;
    this.controller?.abort();
    this.searchController?.abort();
    this.unsubscribeSaves?.();
    this.unsubscribeSaves = null;
    this.watcher?.dispose();
    this.watcher = null;
    this.coalescer?.dispose();
    this.reload?.dispose();
    this.index?.dispose();
    this.index = null;
    this.indexReady = null;
    this.rescanAfterQueue = false;
    this.documents.clear();
    if (this.disk && this.disk.findInFiles === this.findInFiles) {
      if (this.previousFindInFiles?.owned) this.disk.findInFiles = this.previousFindInFiles.value;
      else delete this.disk.findInFiles;
    }
    this.previousFindInFiles = null;
    this.ui.reset();
  }

  dispose() {
    this.disposed = true;
    this.close();
    this.view.search.removeEventListener('input', this.searchInput);
    this.ui.dispose();
  }
}
