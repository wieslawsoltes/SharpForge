import {SourceText} from '@sharpforge/text';
import {WorkbenchEvents} from '../events.js';
import {VirtualTable} from './virtual-table.js';
import {button, element, field, input, select, runAction} from '../ui.js';

/** Uses the language lexer so TODO-like strings do not become comment tasks. */
export async function scanCommentTasks(documents, tokens, {signal, onProgress = () => {}} = {}) {
  const {lex} = await import('@sharpforge/syntax');
  const tokenMap = new Map(tokens.map(item => [item.token, item.priority]));
  const pattern = new RegExp('\\b(' + [...tokenMap.keys()].join('|') + ')\\b\\s*:?\\s*([^\\r\\n]*)', 'gu');
  const result = [];
  if (!tokenMap.size) return result;
  for (const [index, document] of documents.entries()) {
    signal?.throwIfAborted();
    const source = new SourceText(document.text, document.uri, document.version);
    const syntax = lex(source);
    const seen = new Set();
    for (const token of syntax.tokens) {
      for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
        if (!trivia.kind.includes('Comment') || seen.has(trivia.start)) continue;
        seen.add(trivia.start);
        const text = source.text.slice(trivia.start, trivia.end);
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
          const start = trivia.start + match.index;
          const position = source.positionAt(start);
          result.push({id: document.uri + ':' + start, uri: document.uri, version: document.version,
            projectId: document.projectId, start, end: start + match[0].length, line: position.line + 1,
            priority: tokenMap.get(match[1]), token: match[1], description: match[2].replace(/\*\/$/u, '').trim(), kind: 'comment'});
        }
      }
    }
    onProgress(index + 1);
    if (result.length > 100000) throw new RangeError('Task List limit exceeded');
    if (index % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return result;
}

export class TaskListModel extends WorkbenchEvents {
  constructor({documents, settings, storage, workspaceId = 'default'}) {
    super();
    Object.assign(this, {documents, settings, storage});
    this.key = 'sharpforge.workbench.user-tasks.' + workspaceId;
    this.comments = [];
    this.userTasks = [];
    this.serial = 0;
    this.generation = 0;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? 'null');
      if (saved?.version === 1 && Array.isArray(saved.items)) this.userTasks = saved.items.slice(0, 1000);
    } catch (error) { this.loadError = error.message; }
  }
  async scan({signal} = {}) {
    const generation = ++this.generation;
    const result = await scanCommentTasks(this.documents.list(), this.settings.get('tasks', 'tokens'), {signal});
    if (generation !== this.generation) return;
    this.comments = result.filter(row => this.documents.get(row.uri)?.version === row.version);
    this.emit({type: 'changed'});
  }
  add(description, priority = 'normal') {
    if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new TypeError('Invalid user task');
    this.userTasks.push({id: 'user:' + Date.now() + ':' + ++this.serial, kind: 'user', description, priority, completed: false});
    if (this.userTasks.length > 1000) throw new RangeError('User task limit exceeded');
    this.save();
  }
  save() {
    this.storage?.setItem(this.key, JSON.stringify({version: 1, items: this.userTasks}));
    this.emit({type: 'changed'});
  }
  rows(kind = 'all') { return [...this.comments, ...this.userTasks].filter(item => kind === 'all' || item.kind === kind); }
  dispose() { this.generation++; super.dispose(); }
}

export function mountTaskList(host, {model, navigate, dialogs, onError}) {
  const document = host.ownerDocument;
  let kind = 'all';
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const gridHost = element(document, 'div', {className: 'wb-grid-host'});
  host.replaceChildren(toolbar, gridHost);
  const grid = new VirtualTable(gridHost, {label: 'Task List', columns: [
    {id: 'priority', title: 'Priority', width: '80px'}, {id: 'description', title: 'Description', width: 'minmax(220px, 2fr)'},
    {id: 'uri', title: 'File', width: 'minmax(160px, 1fr)'}, {id: 'line', title: 'Line', width: '65px'},
    {id: 'completed', title: 'Completed', width: '90px'}
  ], onActivate: runAction(row => row.uri ? navigate({...row, line: row.line - 1}) : undefined, onError)});
  const refresh = () => grid.setRows(model.rows(kind));
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
