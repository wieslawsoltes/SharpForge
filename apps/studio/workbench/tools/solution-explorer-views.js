import {buildSolutionTree} from '@sharpforge/project-system';
import {createToolTree} from './tree-host.js';
import {button, checkbox, input, runAction} from '../ui.js';

export class SolutionExplorerViews {
  constructor({getData, documents, context}) { Object.assign(this, {getData, documents, context}); this.instances = new Map(); this.serial = 0; }
  create({scope = null} = {}) {
    const instance = {id: 'solution-view:' + ++this.serial, scope, history: [scope], index: 0,
      showAll: false, openOnly: false, pendingOnly: false, contentSearch: false, search: '', expanded: new Set()};
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
  nodes(view) {
    const data = this.getData();
    let roots = buildSolutionTree({...data, showAll: view.showAll});
    const files = new Map(this.documents.list().map(file => [file.uri, file]));
    const context = this.context();
    const filter = nodes => nodes.flatMap(node => {
      const children = filter(node.children ?? []);
      const file = files.get(node.path);
      const isFile = !node.children?.length;
      const accepted = (!view.openOnly || context.openUris?.includes(node.path)) &&
        (!view.pendingOnly || file?.dirty || data.dirtyFiles?.has?.(node.path)) &&
        (!view.search || node.label.toLowerCase().includes(view.search.toLowerCase()) ||
          view.contentSearch && file?.text.toLowerCase().includes(view.search.toLowerCase()));
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
  const render = () => {
    tree.setNodes(model.nodes(view));
    tree.status.textContent = `${view.scope ? 'Scoped view' : 'Entire solution'} · ${tree.model.nodes.size} items`;
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
    }), button(host.ownerDocument, 'New Solution Explorer View', () => openNew(model.create({scope: view.scope}).id)));
  for (const [label, key] of [['Show All Files', 'showAll'], ['Open files', 'openOnly'],
    ['Pending changes', 'pendingOnly'], ['Search file contents', 'contentSearch']]) {
    tree.toolbar.append(checkbox(host.ownerDocument, label, view[key], value => { view[key] = value; render(); }));
  }
  tree.toolbar.append(input(host.ownerDocument, 'Search Solution Explorer', view.search, value => { view.search = value; render(); }));
  render();
  return {refresh: render, dispose: () => tree.dispose()};
}
