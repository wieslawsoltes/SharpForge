import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '@sharpforge/controls';
import {LazyExplorerTree, resolveLazyExplorerPath} from '@sharpforge/project-system';
import {ExplorerChildLoader} from '../apps/studio/explorer/child-loader.js';
import {revealExplorerPath} from '../apps/studio/explorer/reveal.js';

function fixture(tree) {
  const model = new TreeModel([tree.root]);
  const abort = new AbortController();
  const state = {identity: 'workspace', revision: 1, disk: {}};
  const observed = {focus: 0, visible: 0, properties: null};
  const explorer = {model, abort, lazyTree: {model: tree}, getData: () => state, scope: null,
    search: {value: ''}, tree: {focus() { observed.focus++; }}, control: {ensureVisible() { observed.visible++; }},
    onProperties(nodes) { observed.properties = nodes; }};
  explorer.childLoader = new ExplorerChildLoader({model, signal: abort.signal});
  return {explorer, state, observed};
}

test('direct reveal resolves a far page of a 21,000-file directory without admitting preceding siblings', async () => {
  const files = Array.from({length: 21000}, (_, index) => ({path: 'Unit' + String(index).padStart(5, '0') + '.cs', lazy: true}));
  const tree = new LazyExplorerTree({files, deferIndex: true});
  const resolved = await resolveLazyExplorerPath(tree, 'Unit20937.cs');
  assert.equal(resolved.path, 'Unit20937.cs');
  assert.equal(resolved.pages.length, 1);
  assert.equal(resolved.pages[0].page.offset, 20900);
  assert.equal(resolved.pages[0].page.nodes.length, 100);
  assert.equal(resolved.pages[0].page.total, 21000);
  assert.equal(tree.root.children.length, 0);
  assert.equal(await resolveLazyExplorerPath(tree, 'Missing.cs'), null);
  await assert.rejects(resolveLazyExplorerPath(tree, '../Unit20937.cs'), /traversing/);
  tree.dispose();
});

test('ancestor resolution follows provider case identity and preserves original Unicode path spelling', async () => {
  const path = 'Cafe\u0301/Sub/Widget.cs';
  const tree = new LazyExplorerTree({files: [{path, lazy: true}], caseSensitive: false});
  const resolved = await resolveLazyExplorerPath(tree, 'CAFÉ/sub/widget.cs');
  assert.equal(resolved.path, path);
  assert.deepEqual(resolved.pages.map(value => value.parentId), ['workspace:Workspace', 'folder:Cafe\u0301', 'folder:Cafe\u0301/Sub']);
  const app = fixture(tree);
  assert.equal(await revealExplorerPath(app.explorer, 'CAFÉ/sub/widget.cs', true), true);
  assert.equal(app.explorer.model.focused, 'file:' + path);
  assert.deepEqual(app.observed.properties.map(node => node.path), [path]);
  assert.equal(app.observed.focus, 1);
  tree.dispose();
});

test('revealed pages coexist with ordinary pagination and preserve previously expanded descendants', async () => {
  const files = Array.from({length: 310}, (_, index) => ({path: 'Folder' + String(index).padStart(3, '0') + '/A.cs', lazy: true}));
  const tree = new LazyExplorerTree({files});
  const app = fixture(tree);
  const {model, childLoader} = app.explorer;
  await childLoader.expand(model.nodes.get(tree.root.id));
  const first = model.nodes.get('folder:Folder000');
  const firstLoader = first.loadChildren;
  await childLoader.expand(first);
  model.expand(first.id);
  model.setFilter('something else');
  app.explorer.search.value = 'something else';
  assert.equal(await revealExplorerPath(app.explorer, 'Folder250/A.cs'), true);
  assert.equal(model.query, '');
  assert.equal(model.nodes.get(first.id).loadChildren, firstLoader);
  assert(model.nodes.has('file:Folder000/A.cs'));
  assert(model.expanded.has(first.id));
  assert.equal(model.nodes.size, 204); // root, 200 folders, two source leaves and one paging action.
  const targetLoader = model.nodes.get('folder:Folder250').loadChildren;
  await childLoader.loadMore(model.nodes.get(tree.root.id + ':more:100'));
  assert.equal(model.nodes.get(tree.root.id + ':more:300').offset, 300);
  assert.equal(model.nodes.get('folder:Folder250').loadChildren, targetLoader);
  assert(model.nodes.has('file:Folder250/A.cs'));
  await childLoader.loadMore(model.nodes.get(tree.root.id + ':more:300'));
  assert.equal(model.nodes.get(tree.root.id).children.length, 310);
  assert.equal(model.nodes.get(tree.root.id).children.some(node => node.kind === 'load-more'), false);
  tree.dispose();
});

test('delayed reveal cannot select or populate a replacement tree with identical workspace and node IDs', async () => {
  const waiting = Promise.withResolvers();
  class DelayedTree extends LazyExplorerTree {
    async prepare(signal) { await waiting.promise; return super.prepare(signal); }
  }
  const old = new DelayedTree({files: [{path: 'Old.cs', lazy: true}]});
  const app = fixture(old);
  const pending = revealExplorerPath(app.explorer, 'Old.cs');
  const replacement = new LazyExplorerTree({files: [{path: 'Current.cs', lazy: true}]});
  app.explorer.lazyTree = {model: replacement};
  app.explorer.model.setNodes([replacement.root]);
  app.state.disk = {};
  waiting.resolve();
  assert.equal(await pending, false);
  assert.equal(app.explorer.model.nodes.has('file:Old.cs'), false);
  assert.equal(app.observed.visible, 0);
  assert.equal(await revealExplorerPath(app.explorer, 'Current.cs'), true);
  old.dispose();
  replacement.dispose();
});

test('in-place source revision changes and disposal cancel delayed reveal before any staged page is published', async () => {
  for (const stop of [app => { app.state.revision++; }, app => app.explorer.abort.abort()]) {
    const waiting = Promise.withResolvers();
    class DelayedTree extends LazyExplorerTree {
      async prepare(signal) { await waiting.promise; return super.prepare(signal); }
    }
    const tree = new DelayedTree({files: [{path: 'A.cs', lazy: true}]});
    const app = fixture(tree);
    const roots = app.explorer.model.roots;
    const pending = revealExplorerPath(app.explorer, 'A.cs');
    stop(app);
    waiting.resolve();
    assert.equal(await pending, false);
    assert.equal(app.explorer.model.roots, roots);
    assert.equal(app.observed.visible, 0);
    tree.dispose();
  }
});

test('invalid later ancestor pages leave the entire live tree unchanged', () => {
  const tree = new LazyExplorerTree();
  const app = fixture(tree);
  const roots = app.explorer.model.roots;
  assert.throws(() => app.explorer.childLoader.admitPages([
    {parentId: tree.root.id, page: {nodes: [{id: 'folder', loadChildren: async () => []}], offset: 0, total: 1, hasMore: false}},
    {parentId: 'folder', page: {nodes: [{id: tree.root.id}], offset: 0, total: 1, hasMore: false}}
  ]), /unique|limit/);
  assert.equal(app.explorer.model.roots, roots);
  assert.equal(app.explorer.model.nodes.size, 1);
  tree.dispose();
});
