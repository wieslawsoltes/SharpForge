import {buildSolutionTree} from '@sharpforge/project-system';
import {createToolTree} from './tree-host.js';
import {button, checkbox, input, runAction} from '../ui.js';
import {boundedDocuments} from '../document-size.js';
import {abortError} from '../events.js';

export class SolutionExplorerViews {
  constructor({getData, documents, context, search}) {
    Object.assign(this, {getData, documents, context, search});
    this.instances = new Map();
    this.serial = 0;
  }
  create({scope = null} = {}) {
    if (this.instances.size >= 20) throw new Error('At most 20 Solution Explorer views can be retained');
    const instance = {id: 'solution-view:' + ++this.serial, scope, history: [scope], index: 0,
      showAll: false, openOnly: false, pendingOnly: false, contentSearch: false, search: '', expanded: new Set(),
      contentMatches: new Set(), contentQuery: '', contentKey: '', contentStatus: '', controller: null};
    this.instances.set(instance.id, instance);
    return instance;
  }
  navigate(view, scope) {
    view.scope = scope;
    view.history.splice(view.index + 1);
    view.history.push(scope);
    if (view.history.length > 100) view.history.shift();
    view.index = view.history.length - 1;
  }
  step(view, delta) {
    view.index = Math.max(0, Math.min(view.history.length - 1, view.index + delta));
    view.scope = view.history[view.index];
  }
  /** Content filtering uses the cancellable search worker; rendering only reads retained URI matches. */
  async findContents(view) {
    if (!view.contentSearch || !view.search) {
      this.cancel(view);
      view.contentMatches.clear();
      view.contentStatus = '';
      view.contentKey = '';
      return;
    }
    const records = this.documents.list();
    const versions = records.map(record => [record.uri, record.version]);
    const key = JSON.stringify([view.search, versions]);
    if (key === view.contentKey) return;
    this.cancel(view);
    const controller = view.controller = new AbortController();
    view.contentMatches.clear();
    view.contentQuery = view.search;
    view.contentStatus = 'Searching file contents…';
    try {
      if (!this.search?.createWorker) throw new Error('Content filtering requires an interruptible search worker');
      const files = boundedDocuments(this.documents, records, {maxFile: 8_000_000, maxTotal: 32_000_000});
      const result = await this.search.search(files, view.search, {}, controller.signal);
      controller.signal.throwIfAborted();
      if (view.controller !== controller) return;
      if (versions.some(([uri, version]) => this.documents.get(uri)?.version !== version)) throw abortError('Source changed during content filtering');
      view.contentMatches = new Set(result.matches.map(match => match.uri));
      view.contentStatus = `${view.contentMatches.size} matching files` + (result.truncated ? ' · result limit reached' : '');
      view.contentKey = key;
    } catch (error) {
      if (error.name !== 'AbortError' && view.controller === controller) {
        view.contentStatus = 'Content filter unavailable: ' + error.message;
        view.contentKey = key;
      }
      throw error;
    } finally {
      if (view.controller === controller) view.controller = null;
    }
  }
  cancel(view) { view.controller?.abort(); view.controller = null; }
  dispose() {
    for (const view of this.instances.values()) this.cancel(view);
    this.instances.clear();
  }
  nodes(view) {
    const data = this.getData();
    let roots = buildSolutionTree({...data, showAll: view.showAll});
    const files = new Map(this.documents.list().map(file => [file.uri, file]));
    const context = this.context();
    const openUris = new Set(context.openUris);
    const pending = new Set(data.dirty ?? []);
    const query = view.search.toLowerCase();
    const filter = nodes => nodes.flatMap(node => {
      const children = filter(node.children ?? []);
      const file = files.get(node.path);
      const isFile = !node.children?.length;
      const accepted = (!view.openOnly || openUris.has(node.path)) &&
        (!view.pendingOnly || file?.dirty || pending.has(node.path) || data.dirtyFiles?.has?.(node.path)) &&
        (!query || node.label.toLowerCase().includes(query) ||
          view.contentSearch && view.contentQuery === view.search && view.contentMatches.has(node.path));
      if (children.length || accepted && (isFile || !view.openOnly && !view.pendingOnly)) return [{...node, children}];
      return [];
    });
    if (view.scope) {
      const find = nodes => nodes.flatMap(node => node.id === view.scope ? [node] : find(node.children ?? []));
      roots = find(roots);
    }
    return filter(roots);
  }
}

export function mountSolutionExplorerView(host, {model, view = model.create(), navigate, openNew, onError}) {
  const tree = createToolTree(host, {label: 'Solution Explorer View', onError,
    onOpen: node => node.path ? navigate({uri: node.path, preview: true}) : undefined});
  let timer, disposed = false;
  const render = () => {
    tree.setNodes(model.nodes(view));
    tree.status.textContent = `${view.scope ? 'Scoped view' : 'Entire solution'} · ${tree.model.nodes.size} items` +
      (view.contentSearch && view.contentStatus ? ' · ' + view.contentStatus : '');
  };
  const refresh = () => {
    clearTimeout(timer);
    model.cancel(view);
    render();
    timer = setTimeout(async () => {
      try { await model.findContents(view); }
      catch (error) { if (error.name !== 'AbortError' && !disposed) onError(error); }
      if (!disposed) render();
    }, 120);
  };
  tree.toolbar.replaceChildren();
  tree.toolbar.append(button(host.ownerDocument, 'Back', () => { model.step(view, -1); render(); }),
    button(host.ownerDocument, 'Forward', () => { model.step(view, 1); render(); }),
    button(host.ownerDocument, 'Home', () => { model.navigate(view, null); render(); }),
    button(host.ownerDocument, 'Sync with Active Document', () => {
      const node = [...tree.model.nodes.values()].find(item => item.path === model.context().uri);
      if (node) { tree.model.reveal(node.id); tree.view.ensureVisible(); tree.area.focus(); }
    }), button(host.ownerDocument, 'Collapse All', () => tree.model.expandAll(false)),
    button(host.ownerDocument, 'Scope to Selection', () => {
      const selected = [...tree.model.selected][0];
      if (selected) { model.navigate(view, selected); render(); }
    }), button(host.ownerDocument, 'New Solution Explorer View', runAction(() => openNew(model.create({scope: view.scope}).id), onError)));
  for (const [label, key] of [['Show All Files', 'showAll'], ['Open files', 'openOnly'],
    ['Pending changes', 'pendingOnly'], ['Search file contents', 'contentSearch']]) {
    tree.toolbar.append(checkbox(host.ownerDocument, label, view[key], value => { view[key] = value; refresh(); }));
  }
  tree.toolbar.append(input(host.ownerDocument, 'Search Solution Explorer', view.search, value => { view.search = value; refresh(); }));
  refresh();
  return {refresh, dispose: () => { disposed = true; clearTimeout(timer); model.cancel(view); tree.dispose(); }};
}
