import {scanCommentTasks} from '../comment-tasks.js';
import {boundedDocuments, documentSize} from '../document-size.js';
import {workerRequest} from '../worker-request.js';
import {WorkbenchEvents} from '../events.js';
import {VirtualTable} from './virtual-table.js';
import {button, element, field, input, select, runAction} from '../ui.js';

export {scanCommentTasks} from '../comment-tasks.js';

export class TaskListModel extends WorkbenchEvents {
  constructor({documents, settings, storage, workspaceId = 'default', createWorker}) {
    super();
    Object.assign(this, {documents, settings, storage, createWorker});
    this.key = 'sharpforge.workbench.user-tasks.' + workspaceId;
    this.comments = [];
    this.userTasks = [];
    this.serial = 0;
    this.generation = 0;
    this.skipped = [];
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? 'null');
      if (saved?.version === 1 && Array.isArray(saved.items)) this.userTasks = saved.items.slice(0, 1000);
    } catch (error) { this.loadError = error.message; }
  }
  async scan({signal} = {}) {
    const generation = ++this.generation;
    this.scanController?.abort();
    this.scanController = new AbortController();
    const controller = this.scanController;
    const abort = () => controller.abort(signal.reason);
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, {once: true});
    let result;
    try {
      const records = this.documents.list();
      this.skipped = records.filter(record => {
        const size = documentSize(this.documents, record);
        return size === null || size > 8_000_000;
      });
      const skipped = new Set(this.skipped);
      const snapshots = boundedDocuments(this.documents, records.filter(record => !skipped.has(record)),
        {maxFile: 8_000_000, maxTotal: 32_000_000});
      const tokens = this.settings.get('tasks', 'tokens');
      result = this.createWorker ? await workerRequest({operation: 'comment-tasks', documents: snapshots, tokens},
        {createWorker: this.createWorker, signal: controller.signal, timeoutMs: 10000}) :
        await scanCommentTasks(snapshots, tokens, {signal: controller.signal});
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.scanController === controller) this.scanController = null;
    }
    if (generation !== this.generation) return;
    this.comments = result.filter(row => this.documents.get(row.uri)?.version === row.version);
    this.emit({type: 'changed'});
  }
  add(description, priority = 'normal') {
    if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new TypeError('Invalid user task');
    if (this.userTasks.length >= 1000) throw new RangeError('User task limit exceeded');
    this.userTasks.push({id: 'user:' + Date.now() + ':' + ++this.serial, kind: 'user', description, priority, completed: false});
    this.save();
  }
  save() {
    this.storage?.setItem(this.key, JSON.stringify({version: 1, items: this.userTasks}));
    this.emit({type: 'changed'});
  }
  rows(kind = 'all') { return [...this.comments, ...this.userTasks].filter(item => kind === 'all' || item.kind === kind); }
  dispose() {
    this.generation++;
    this.scanController?.abort();
    super.dispose();
  }
}

export function mountTaskList(host, {model, navigate, dialogs, onError}) {
  const document = host.ownerDocument;
  let kind = 'all';
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const gridHost = element(document, 'div', {className: 'wb-grid-host'});
  const status = element(document, 'p', {className: 'wb-tool-status', role: 'status'});
  host.replaceChildren(toolbar, gridHost, status);
  const grid = new VirtualTable(gridHost, {label: 'Task List', columns: [
    {id: 'priority', title: 'Priority', width: '80px'}, {id: 'description', title: 'Description', width: 'minmax(220px, 2fr)'},
    {id: 'uri', title: 'File', width: 'minmax(160px, 1fr)'}, {id: 'line', title: 'Line', width: '65px'},
    {id: 'completed', title: 'Completed', width: '90px'}
  ], onActivate: runAction(row => row.uri ? navigate({...row, line: row.line - 1}) : undefined, onError)});
  const refresh = () => {
    grid.setRows(model.rows(kind));
    status.textContent = model.skipped.length ? model.skipped.length + ' files exceed the 8 MB automatic comment-scanning limit.' : '';
  };
  toolbar.append(select(document, 'Task kind', ['all', 'comment', 'user'], kind, value => { kind = value; refresh(); }));
  toolbar.append(button(document, 'Scan comments', runAction(async () => { await model.scan(); refresh(); }, onError)));
  toolbar.append(button(document, 'Add user task', () => {
    let text, priority = 'normal';
    dialogs.open({title: 'New User Task', render: body => {
      text = input(document, 'Task description');
      body.append(field(document, 'Description', text), select(document, 'Priority', ['low', 'normal', 'high'], priority,
        value => { priority = value; }));
    }, actions: [{label: 'Add task', run: () => { model.add(text.value, priority); refresh(); return true; }}]});
  }));
  toolbar.append(button(document, 'Toggle completed', () => {
    const row = grid.rows[grid.index];
    if (row?.kind === 'user') { row.completed = !row.completed; model.save(); refresh(); }
  }));
  toolbar.append(button(document, 'Delete user task', () => {
    const row = grid.rows[grid.index];
    if (row?.kind === 'user') { model.userTasks = model.userTasks.filter(item => item.id !== row.id); model.save(); refresh(); }
  }));
  refresh();
  return {refresh, dispose: () => grid.dispose()};
}
