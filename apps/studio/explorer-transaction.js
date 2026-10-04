import { decodeWorkspaceFile } from '@sharpforge/archive';
import { validateItemPath, parseXml } from '@sharpforge/project-system';
import { captureExplorerRecord, prepareExplorerRecord, writeExplorerRecord, explorerSource,
  validateExplorerRecords, withinExplorerPath } from './explorer-records.js';
import { documentStateFor, captureExplorerWorkspace } from './explorer-history.js';
import { ExplorerPathIndex } from './explorer-path-index.js';

const xmlFile = path => /\.(csproj|slnx|props|targets)$/i.test(path);

/** Build a complete browser operation plan without changing an existing record, model, view or saved baseline. */
export class ExplorerTransaction {
  constructor(owner, context) {
    this.before = captureExplorerWorkspace(owner, context);
    this.records = new Map(context.records.map(record => [record.path, captureExplorerRecord(record, { models: true, copyBytes: false })]));
    this.folders = new Set(context.folders ?? []);
    this.paths = new ExplorerPathIndex(this.records.keys(), this.folders);
    this.documentStates = new Map(this.before.documentStates);
    this.created = new Set();
  }

  addModel(record, previous) {
    if (record.model && record.model !== previous?.model) this.created.add(record.model);
    return record;
  }

  state(path, record, options) {
    const state = documentStateFor(record, this.documentStates.get(path), options);
    if (state) this.documentStates.set(record.path, state);
  }

  destination(path) {
    this.paths.assertAvailable(path);
  }

  create(path, operation) {
    this.destination(path);
    let record;
    if (operation.record) {
      record = prepareExplorerRecord(operation.record, path);
      this.addModel(record, operation.record);
    } else if (operation.base64 !== undefined) {
      if (typeof operation.base64 !== 'string' || operation.base64.length > 24 * 1024 * 1024
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(operation.base64)) {
        throw new Error('Invalid/oversized binary item');
      }
      record = decodeWorkspaceFile(path, Uint8Array.from(atob(operation.base64), character => character.charCodeAt(0)));
    } else {
      if (typeof operation.text !== 'string' || operation.text.length > 4 * 1024 * 1024) {
        throw new Error('Text item size limit exceeded');
      }
      record = { path, text: operation.text, version: 1 };
    }
    if (xmlFile(path)) parseXml(record.text);
    this.records.set(path, record);
    this.paths.add(path, true);
    this.state(path, record, { created: true });
  }

  write(path, operation) {
    const previous = this.records.get(path);
    if (!previous) throw new Error('Missing text file: ' + path);
    let record;
    if (operation.record) {
      record = prepareExplorerRecord(operation.record, path);
      if (record.model !== operation.record.model) this.addModel(record, operation.record);
    } else record = this.addModel(writeExplorerRecord(previous, operation.text), previous);
    if (xmlFile(path)) parseXml(record.text);
    if (!explorerSource(record) && typeof record.text !== 'string') throw new Error('Expected text file: ' + path);
    const original = this.documentStates.get(path) ?? documentStateFor(previous);
    if (original) this.documentStates.set(path, original);
    this.records.set(path, record);
    this.state(path, record, { changed: true });
  }

  relocate(path, operation) {
    const descendants = [...this.records].filter(([entry]) => withinExplorerPath(entry, path));
    const folders = [...this.folders].filter(entry => withinExplorerPath(entry, path));
    if (!descendants.length && !folders.length) throw new Error('Source no longer exists: ' + path);
    if (operation.kind === 'move' || operation.kind === 'copy') {
      const destination = validateItemPath(operation.destination);
      if (withinExplorerPath(destination, path)) throw new Error('Destination exists or contains itself: ' + destination);
      this.destination(destination);
      for (const [previousPath, record] of descendants) {
        const nextPath = destination + previousPath.slice(path.length);
        const next = this.addModel(prepareExplorerRecord(record, nextPath, { reuseModel: false }), record);
        this.records.set(nextPath, next);
        this.paths.add(nextPath, true);
        const original = this.documentStates.get(previousPath) ?? documentStateFor(record);
        const state = documentStateFor(next, original, { created: operation.kind === 'copy' });
        if (state) this.documentStates.set(nextPath, state);
      }
      for (const folder of folders) {
        const next = destination + folder.slice(path.length);
        this.folders.add(next);
        this.paths.add(next, false);
      }
    }
    if (operation.kind !== 'copy') {
      for (const [previousPath] of descendants) {
        this.records.delete(previousPath);
        this.paths.remove(previousPath, true);
        this.documentStates.delete(previousPath);
      }
      for (const folder of folders) {
        this.folders.delete(folder);
        this.paths.remove(folder, false);
      }
    }
  }

  prepare(operations, mappings) {
    if (!Array.isArray(operations) || operations.length > 20_000) throw new RangeError('Invalid explorer operation count');
    for (const operation of operations) {
      const path = validateItemPath(operation.path);
      if (operation.kind === 'create') this.create(path, operation);
      else if (operation.kind === 'write') this.write(path, operation);
      else if (operation.kind === 'mkdir') {
        this.destination(path);
        this.folders.add(path);
        this.paths.add(path, false);
      }
      else if (['move', 'copy', 'delete'].includes(operation.kind)) this.relocate(path, operation);
      else throw new Error('Unknown file operation: ' + operation.kind);
    }
    const records = [...this.records.values()];
    validateExplorerRecords(records);
    return { records, folders: [...this.folders], mappings, documentStates: this.documentStates };
  }
}
