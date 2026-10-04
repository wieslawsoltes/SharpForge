import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '@sharpforge/controls';
import {LazyExplorerTree} from '@sharpforge/project-system';
import {SolutionExplorer} from '../apps/studio/explorer/view.js';
import {ExplorerChildLoader} from '../apps/studio/explorer/child-loader.js';
import {beginLazyExplorerRestore, restoreLazyExplorerState, cacheLazyExplorerRoots} from '../apps/studio/explorer/lazy-state.js';

function fixture(files, Tree = LazyExplorerTree) {
  const state = {identity: 'physical-root', name: 'Workspace', revision: 1, records: files, folders: [], disk: {lazy: true}};
  const observed = {errors: [], saves: 0, visible: 0};
  const button = {setAttribute() {}};
  const explorer = Object.assign(Object.create(SolutionExplorer.prototype), {
    key: state.identity, getData: () => state, model: new TreeModel(), abort: new AbortController(), scope: null,
    search: {value: ''}, tree: {scrollTop: 0, setAttribute() {}, focus() {}}, view: 'folders', track: false,
    toolbar: {querySelector: () => button}, allButton: button, viewButton: {...button},
    control: {ensureVisible() { observed.visible++; }}, persistence: {observe() {}}, diskServices: {observe() {}},
    updateCaption() {}, onProperties() {}, onError: error => observed.errors.push(error),
    saveState() { if (!this.restoring && !this.lazyStateRestore) observed.saves++; }
  });
  explorer.childLoader = new ExplorerChildLoader({model: explorer.model, signal: explorer.abort.signal,
    onUpdate: () => cacheLazyExplorerRoots(explorer)});
  const tree = new Tree({files, deferIndex: true});
  explorer.lazyTree = {model: tree, roots: [tree.root]};
  explorer.model.setNodes([tree.root]);
  return {explorer, state, observed};
}

function planFor(explorer, path, options = {}) {
  const id = 'file:' + path;
  return beginLazyExplorerRestore(explorer, {snapshot: {version: 1, expanded: [explorer.lazyTree.model.root.id],
    selected: [id], focused: id, anchor: id}, nodes: new Map(), scope: null, mappingGroups: [],
    scrollTop: 480, query: '', ...options});
}

test('actual lazy view refresh retains a nonactive far-page selection, focus, expansion and scroll', async () => {
  const files = Array.from({length: 2101}, (_, index) => ({path: 'Unit' + String(index).padStart(4, '0') + '.cs', lazy: true}));
  const {explorer, state, observed} = fixture(files);
  state.active = 'Unit0000.cs';
  explorer.track = true;
  explorer.render(true);
  await explorer.lazyRestoreTask;
  assert.equal(explorer.model.focused, 'file:Unit0000.cs');
  await explorer.reveal('Unit2098.cs');
  explorer.tree.scrollTop = 480;
  const oldTree = explorer.lazyTree.model;
  state.revision++;
  explorer.render();
  await explorer.lazyRestoreTask;
  assert.notEqual(explorer.lazyTree.model, oldTree);
  assert(oldTree.disposed);
  assert.deepEqual([...explorer.model.selected], ['file:Unit2098.cs']);
  assert.equal(explorer.model.focused, 'file:Unit2098.cs');
  assert(explorer.model.expanded.has('workspace:Workspace'));
  assert.equal(explorer.tree.scrollTop, 480);
  assert(explorer.model.nodes.size < 220);
  assert.equal(explorer.model.nodes.has('file:Unit1000.cs'), false);
  assert.deepEqual(observed.errors, []);
  explorer.lazyTree.model.dispose();
});

test('scoping retains the full admitted cache and paging inside the scope survives Home', async () => {
  const files = Array.from({length: 150}, (_, index) => ({path: 'A/Unit' + String(index).padStart(3, '0') + '.cs', lazy: true}));
  files.push({path: 'B/Other.cs', lazy: true});
  const {explorer, observed} = fixture(files);
  explorer.render(true);
  await explorer.lazyRestoreTask;
  const tree = explorer.lazyTree.model;
  explorer.scopeTo(explorer.model.nodes.get('folder:A'));
  await explorer.expand(explorer.model.nodes.get('folder:A'));
  assert.equal(explorer.lazyTree.model, tree);
  assert.equal(explorer.scope, 'folder:A');
  await explorer.loadMore(explorer.model.nodes.get('folder:A:more:100'));
  assert.equal(explorer.lazyTree.roots[0].id, 'workspace:Workspace');
  assert(explorer.lazyTree.roots[0].children.some(node => node.id === 'folder:B'));
  assert.equal(explorer.model.nodes.has('file:A/Unit149.cs'), true);
  explorer.scope = null;
  explorer.render();
  assert.equal(explorer.model.nodes.has('folder:B'), true);
  assert.equal(explorer.model.nodes.has('file:A/Unit149.cs'), true);
  assert.deepEqual(observed.errors, []);
  tree.dispose();
});

test('transaction mappings restore a renamed scoped folder and focused file under their current IDs', async () => {
  const {explorer, state, observed} = fixture([{path: 'Before/Item.cs', lazy: true}, {path: 'Other.cs', lazy: true}]);
  explorer.render(true);
  await explorer.lazyRestoreTask;
  await explorer.reveal('Before/Item.cs');
  explorer.scopeTo(explorer.model.nodes.get('folder:Before'));
  await explorer.expand(explorer.model.nodes.get('folder:Before'));
  state.records = [{path: 'After/Renamed.cs', lazy: true}, {path: 'Other.cs', lazy: true}];
  state.revision++;
  explorer.prepareMappings([{from: 'Before/Item.cs', to: 'After/Renamed.cs'}, {from: 'Before', to: 'After'}]);
  explorer.render();
  await explorer.lazyRestoreTask;
  assert.equal(explorer.scope, 'folder:After');
  assert.equal(explorer.model.roots[0].id, 'folder:After');
  assert.equal(explorer.model.focused, 'file:After/Renamed.cs');
  assert.deepEqual([...explorer.model.selected], ['file:After/Renamed.cs']);
  assert(explorer.model.expanded.has('folder:After'));
  assert.equal(explorer.model.nodes.has('file:Before/Item.cs'), false);
  assert(observed.visible > 0);
  assert.deepEqual(observed.errors, []);
  explorer.lazyTree.model.dispose();
});

test('serialized lazy state restores through stable IDs without retaining the prior node objects', async () => {
  const {explorer} = fixture([{path: 'Folder/Retained.cs', lazy: true}]);
  const plan = planFor(explorer, 'Folder/Retained.cs', {query: 'Retained', snapshot: {version: 1,
    expanded: ['workspace:Workspace', 'folder:Folder'], selected: ['file:Folder/Retained.cs'],
    focused: 'file:Folder/Retained.cs', anchor: 'file:Folder/Retained.cs'}});
  assert.equal(await restoreLazyExplorerState(explorer, plan), true);
  assert.equal(explorer.model.focused, 'file:Folder/Retained.cs');
  assert(explorer.model.expanded.has('folder:Folder'));
  assert.equal(explorer.model.query, 'retained');
  assert.equal(explorer.tree.scrollTop, 480);
  explorer.lazyTree.model.dispose();
});

test('delayed state restoration discards workspace replacements, edits, user selection, scrolling and cancellation', async () => {
  const mutations = [
    app => { app.state.disk = {lazy: true}; },
    app => { app.state.revision++; },
    app => app.explorer.model.select('workspace:Workspace'),
    app => { app.explorer.tree.scrollTop = 12; },
    app => app.explorer.abort.abort()
  ];
  for (const mutate of mutations) {
    const waiting = Promise.withResolvers();
    const started = Promise.withResolvers();
    class DelayedTree extends LazyExplorerTree {
      async prepare(signal) { started.resolve(); await waiting.promise; return super.prepare(signal); }
    }
    const app = fixture([{path: 'Old.cs', lazy: true}], DelayedTree);
    const roots = app.explorer.model.roots;
    const pending = restoreLazyExplorerState(app.explorer, planFor(app.explorer, 'Old.cs'));
    await started.promise;
    mutate(app);
    waiting.resolve();
    assert.equal(await pending, false);
    assert.equal(app.explorer.model.roots, roots);
    assert.equal(app.explorer.model.nodes.has('file:Old.cs'), false);
    assert.equal(app.observed.saves, 0);
    assert.equal(app.explorer.lazyStateRestore, null);
    app.explorer.lazyTree.model.dispose();
  }
});

test('same-ID disk replacement rebuilds the actual view without retaining the previous physical entries', async () => {
  const app = fixture([{path: 'Old.cs', lazy: true}]);
  app.explorer.render(true);
  await app.explorer.lazyRestoreTask;
  const old = app.explorer.lazyTree.model;
  app.state.disk = {lazy: true};
  app.state.records = [{path: 'Current.cs', lazy: true}];
  app.explorer.render();
  await app.explorer.lazyRestoreTask;
  assert(old.disposed);
  assert.equal(app.explorer.model.nodes.has('file:Old.cs'), false);
  assert.equal(app.explorer.model.nodes.has('file:Current.cs'), true);
  app.explorer.lazyTree.model.dispose();
});

test('invalid current pages never publish a partial restoration into the visible tree or full cache', async () => {
  class InvalidTree extends LazyExplorerTree {
    async loadChildren(path, options) {
      const page = await super.loadChildren(path, options);
      return {...page, nodes: [...page.nodes, {...page.nodes[0], id: this.root.id}], total: 2, hasMore: false};
    }
  }
  const invalid = fixture([{path: 'A.cs', lazy: true}], InvalidTree);
  const roots = invalid.explorer.model.roots;
  const cache = invalid.explorer.lazyTree.roots;
  await assert.rejects(restoreLazyExplorerState(invalid.explorer, planFor(invalid.explorer, 'A.cs')), /unique/);
  assert.equal(invalid.explorer.model.roots, roots);
  assert.equal(invalid.explorer.lazyTree.roots, cache);
  assert.equal(invalid.explorer.model.nodes.size, 1);
  invalid.explorer.lazyTree.model.dispose();
});
