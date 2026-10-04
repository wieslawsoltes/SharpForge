import {WorkbenchEvents} from '../events.js';
import {SourceText} from '@sharpforge/text';
import {VirtualTable} from './virtual-table.js';
import {button, element, input, field, runAction} from '../ui.js';
import {documentSize} from '../document-size.js';

export class Bookmarks extends WorkbenchEvents {
  constructor({documents, storage, workspaceId = 'default', onError = () => {}}) {
    super();
    this.documents = documents;
    this.storage = storage;
    this.key = 'sharpforge.workbench.bookmarks.' + workspaceId;
    this.items = [];
    this.serial = 0;
    this.snapshots = new Map();
    this.onError = onError;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? 'null');
      if (saved?.version === 1 && Array.isArray(saved.items)) this.items = saved.items.filter(item =>
        typeof item.uri === 'string' && Number.isSafeInteger(item.offset) && item.offset >= 0).slice(0, 10000);
    } catch (error) { onError(error); }
    for (const uri of new Set(this.items.map(item => item.uri))) this.capture(uri);
  }
  capture(uri) {
    const file = this.documents.get(uri);
    if (!file || this.documents.models?.has(uri)) return;
    const size = documentSize(this.documents, file);
    if (size !== null && size <= 8_000_000) this.snapshots.set(uri, file.text);
  }
  save() {
    this.storage?.setItem(this.key, JSON.stringify({version: 1, items: this.items}));
    this.emit({type: 'changed'});
  }
  toggle(uri, offset) {
    const file = this.documents.get(uri);
    const size = file && documentSize(this.documents, file);
    if (!file || size === null || !Number.isInteger(offset) || offset < 0 || offset > size) throw new RangeError('Invalid bookmark location');
    const source = this.documents.models?.get(uri) ?? new SourceText(file.text, uri, file.version);
    const line = source.positionAt(offset).line;
    const existing = this.items.find(item => item.uri === uri && source.positionAt(item.offset).line === line);
    if (existing) this.items = this.items.filter(item => item !== existing);
    else {
      if (this.items.length >= 10000) throw new RangeError('Bookmark limit exceeded');
      const start = source.getLineStart?.(line) ?? source.lineStarts[line];
      const name = source.getText ? source.getText(start, Math.min(size, start + 120)) : source.text.slice(start, start + 120);
      this.items.push({id: 'bookmark:' + Date.now() + ':' + ++this.serial, uri, offset,
        name: name.split(/\r?\n/u)[0].trim() || 'Bookmark', folder: '', enabled: true});
      this.capture(uri);
    }
    this.save();
  }
  trackChanges(event = {}) {
    let changed = false;
    const changes = event.changes ?? event.change?.changes;
    if (event.uri && Array.isArray(changes)) {
      for (const item of this.items.filter(entry => entry.uri === event.uri)) {
        item.offset = trackOffset(item.offset, changes);
        changed = true;
      }
      this.capture(event.uri);
      if (changed) this.save();
      return;
    }
    for (const uri of new Set(this.items.map(item => item.uri))) {
      const file = this.documents.get(uri);
      if (!file || this.documents.models?.has(uri)) continue;
      const before = this.snapshots.get(file.uri);
      this.capture(uri);
      if (before === undefined || before === file.text) continue;
      let start = 0;
      while (start < before.length && start < file.text.length && before[start] === file.text[start]) start++;
      let oldEnd = before.length, end = file.text.length;
      while (oldEnd > start && end > start && before[oldEnd - 1] === file.text[end - 1]) { oldEnd--; end--; }
      for (const item of this.items.filter(entry => entry.uri === file.uri)) {
        if (item.offset >= oldEnd) item.offset += end - oldEnd;
        else if (item.offset > start) item.offset = end;
        changed = true;
      }
    }
    if (changed) this.save();
  }
  rows() {
    return this.items.map(item => {
      const document = this.documents.get(item.uri);
      const source = document && (this.documents.models?.get(item.uri) ?? new SourceText(document.text));
      const position = source?.positionAt(item.offset);
      return {...item, line: position ? position.line + 1 : '?', version: document?.version, missing: !document};
    });
  }
  next(uri, offset, backwards = false) {
    const rows = this.rows().filter(item => item.enabled && !item.missing).sort((left, right) =>
      left.uri.localeCompare(right.uri) || left.offset - right.offset);
    if (!rows.length) return null;
    const compare = item => item.uri.localeCompare(uri) || item.offset - offset;
    if (backwards) return rows.findLast(item => compare(item) < 0) ?? rows.at(-1);
    return rows.find(item => compare(item) > 0) ?? rows[0];
  }
}

/** Transform an anchor against edits expressed in the previous document's UTF-16 coordinates. */
export function trackOffset(offset, changes) {
  let delta = 0;
  for (const change of [...changes].sort((left, right) => left.start - right.start)) {
    if (offset < change.start) break;
    const length = (change.text ?? change.newText ?? '').length;
    if (offset <= change.end) return change.start + delta + length;
    delta += length - (change.end - change.start);
  }
  return offset + delta;
}

export function mountBookmarks(host, {model, navigate, context, dialogs, onError}) {
  const document = host.ownerDocument;
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const body = element(document, 'div', {className: 'wb-grid-host'});
  host.replaceChildren(toolbar, body);
  const grid = new VirtualTable(body, {label: 'Bookmarks', columns: [
    {id: 'enabled', title: 'Enabled', width: '70px'}, {id: 'folder', title: 'Folder', width: '100px'},
    {id: 'name', title: 'Name', width: 'minmax(160px, 1fr)'}, {id: 'uri', title: 'File', width: 'minmax(140px, 1fr)'},
    {id: 'line', title: 'Line', width: '60px'}
  ], onActivate: runAction(row => navigate({...row, start: row.offset}), onError)});
  const refresh = () => grid.setRows(model.rows());
  toolbar.append(button(document, 'Toggle bookmark', () => { model.toggle(context().uri, context().offset); refresh(); }));
  toolbar.append(button(document, 'Enable / Disable', () => {
    const row = grid.rows[grid.index], item = model.items.find(entry => entry.id === row?.id);
    if (item) { item.enabled = !item.enabled; model.save(); refresh(); }
  }));
  toolbar.append(button(document, 'Rename / Folder', () => {
    const row = grid.rows[grid.index], item = model.items.find(entry => entry.id === row?.id);
    if (!item) return;
    let name, folder;
    dialogs.open({title: 'Bookmark Properties', render: body => {
      name = input(document, 'Name', item.name); folder = input(document, 'Folder', item.folder);
      body.append(field(document, 'Name', name), field(document, 'Folder', folder));
    }, actions: [{label: 'Save', run: () => { item.name = name.value; item.folder = folder.value; model.save(); refresh(); return true; }}]});
  }));
  toolbar.append(button(document, 'Remove', () => {
    model.items = model.items.filter(item => item.id !== grid.rows[grid.index]?.id); model.save(); refresh();
  }));
  refresh();
  return {refresh, dispose: () => grid.dispose()};
}
