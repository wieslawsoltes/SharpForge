import {element, button, runAction} from './ui.js';
import {boundedDocuments, documentSize} from './document-size.js';

/** Browser file handles are polled only through explicitly supplied readers; permissions are never persisted. */
export class FileWatch {
  constructor({documents, readDisk, reload, compare, notify, storage, workspaceId = 'default', clock = () => Date.now()}) {
    Object.assign(this, {documents, readDisk, reload, compare, notify, storage, clock});
    this.key = 'sharpforge.workbench.recovery.' + workspaceId;
    this.baselines = new Map();
    this.prompted = new Map();
    this.disposed = false;
    this.polling = false;
    this.timer = null;
    this.recoveryPending = Boolean(storage?.getItem(this.key));
    this.largeFiles = new Map();
  }
  canReadAutomatically(document) {
    const size = documentSize(this.documents, document);
    if (size !== null && size <= 8_000_000) return true;
    if (this.largeFiles.get(document.uri) !== document.version) {
      this.largeFiles.set(document.uri, document.version);
      this.notify({id: 'large-file-recovery:' + document.uri, code: 'SF-WB-LARGE-RECOVERY', severity: 'info',
        message: document.uri + ' exceeds automatic recovery and disk polling limits. Save it explicitly to preserve changes.'});
    }
    return false;
  }
  async poll({signal} = {}) {
    if (this.polling || this.disposed || !this.readDisk) return;
    this.polling = true;
    try {
      for (const document of this.documents.list()) {
        signal?.throwIfAborted();
        if (!this.canReadAutomatically(document)) continue;
        const disk = await this.readDisk(document.uri, {signal});
        if (disk === null || disk === undefined || this.disposed) continue;
        const text = typeof disk === 'string' ? disk : disk.text;
        if (typeof text !== 'string') continue;
        const previous = this.baselines.get(document.uri);
        this.baselines.set(document.uri, text);
        if (previous === undefined && text === document.text || previous === text || text === document.text) continue;
        if (this.prompted.get(document.uri) === text) continue;
        this.prompted.set(document.uri, text);
        const version = document.version;
        this.notify({id: 'disk-change:' + document.uri, message: document.uri + ' changed outside the IDE.', severity: 'warning',
          persistent: true, documentUri: document.uri, actions: [
            {label: 'Reload', run: () => this.reload(document.uri, text, {expectedVersion: version, confirmDirty: true})},
            {label: 'Ignore', run: () => { this.prompted.set(document.uri, text); }},
            {label: 'Compare', run: () => this.compare({uri: document.uri, current: this.documents.get(document.uri)?.text ?? '', disk: text})}
          ]});
      }
    } finally { this.polling = false; }
  }
  snapshot() {
    if (this.recoveryPending) return null;
    const records = this.documents.list().filter(document => document.dirty && this.canReadAutomatically(document));
    const files = boundedDocuments(this.documents, records, {maxFile: 8_000_000, maxTotal: 16_000_000});
    if (!files.length) { this.storage?.removeItem(this.key); return null; }
    const payload = {version: 1, timestamp: this.clock(), files};
    const text = JSON.stringify(payload);
    if (text.length > 20_000_000) throw new Error('Recovery snapshot exceeds 20 MB; save the workspace to disk');
    this.storage?.setItem(this.key, text);
    return payload;
  }
  recovery() {
    const raw = this.storage?.getItem(this.key);
    if (!raw) return null;
    if (raw.length > 20_000_000) throw new Error('Recovery snapshot is oversized');
    const payload = JSON.parse(raw);
    if (payload.version !== 1 || !Array.isArray(payload.files) || payload.files.length > 100000 || payload.files.some(file =>
      typeof file.uri !== 'string' || typeof file.text !== 'string')) throw new Error('Invalid recovery snapshot');
    return payload;
  }
  start(intervalSeconds = 30) {
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3600) throw new RangeError('Recovery interval must be 5..3600 seconds');
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      try { this.snapshot(); } catch (error) { this.notify({severity: 'error', code: 'SF-WB-RECOVERY', message: error.message}); }
      this.poll().catch(error => this.notify({severity: 'warning', code: 'SF-WB-FILE-WATCH', message: error.message}));
    }, intervalSeconds * 1000);
    this.timer.unref?.();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.baselines.clear(); this.prompted.clear(); }
}

export function showDiskCompare(dialogs, {uri, current, disk}) {
  return dialogs.open({title: 'Compare External Changes: ' + uri, render(host) {
    const document = host.ownerDocument;
    const columns = element(document, 'div', {className: 'wb-compare'});
    for (const [label, text] of [['Editor buffer', current], ['Disk version', disk]]) {
      const side = element(document, 'section');
      side.append(element(document, 'h3', {text: label}), element(document, 'pre', {className: 'wb-source', text}));
      columns.append(side);
    }
    host.append(columns);
  }, actions: [{label: 'Close', run: () => true}]});
}

export function showRecovery(dialogs, watch, {restore}) {
  const recovery = watch.recovery();
  if (!recovery?.files.length) return null;
  return dialogs.open({title: 'Recover Unsaved Documents', render(host) {
    host.append(element(host.ownerDocument, 'p', {text: 'Unsaved recovery snapshot: ' + new Date(recovery.timestamp).toLocaleString()}));
    for (const file of recovery.files) host.append(element(host.ownerDocument, 'p', {text: file.uri}));
  }, actions: [
    {label: 'Restore', run: async () => {
      await restore(recovery.files);
      watch.storage?.removeItem(watch.key);
      watch.recoveryPending = false;
      return true;
    }},
    {label: 'Discard snapshot', run: () => {
      watch.storage?.removeItem(watch.key);
      watch.recoveryPending = false;
      return true;
    }}
  ]});
}

/** Directory traversal is bounded and preserves relative paths for the existing workspace importer. */
export async function readDroppedFiles(dataTransfer, {signal, maxFiles = 10000, maxBytes = 100_000_000} = {}) {
  signal?.throwIfAborted();
  const result = [];
  let bytes = 0;
  let visited = 0;
  const append = (file, path) => {
    signal?.throwIfAborted();
    bytes += file.size;
    if (result.length >= maxFiles || bytes > maxBytes) throw new RangeError('Dropped files exceed workspace import limits');
    if (path && path !== file.name) Object.defineProperty(file, 'webkitRelativePath', {value: path, configurable: true});
    result.push(file);
  };
  const visit = async (entry, path = '', depth = 0) => {
    signal?.throwIfAborted();
    if (++visited > maxFiles * 4) throw new RangeError('Dropped folder entry limit exceeded');
    if (depth > 64) throw new RangeError('Dropped folder nesting exceeds 64');
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      append(file, path + entry.name);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!entries.length) break;
        for (const child of entries) await visit(child, path + entry.name + '/', depth + 1);
      }
    }
  };
  const items = [...(dataTransfer.items ?? [])].filter(item => item.kind === 'file');
  if (items.some(item => item.webkitGetAsEntry)) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await visit(entry); else { const file = item.getAsFile(); if (file) append(file); }
    }
  } else for (const file of dataTransfer.files ?? []) append(file);
  return result;
}

export function mountFileDrops(host, {importFiles, onError}) {
  const controller = new AbortController();
  host.addEventListener('dragover', event => {
    if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
  }, {signal: controller.signal});
  host.addEventListener('drop', event => {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault(); event.stopPropagation();
    readDroppedFiles(event.dataTransfer, {signal: controller.signal}).then(importFiles).catch(onError);
  }, {signal: controller.signal});
  return () => controller.abort();
}
