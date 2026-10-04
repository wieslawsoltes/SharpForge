import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyExplorerTree, buildLazyFolderTree} from '@sharpforge/project-system';

test('A24 10000-file folder materializes pages and bounds visible row count', async () => {
  const model = new LazyExplorerTree({files: Array.from({length: 10000}, (_, index) => ({path: `src/File${index}.cs`, lazy: true}))});
  assert.equal(model.root.children.length, 0);
  const root = await model.root.loadChildren();
  assert.equal(root.nodes[0].childCount, 10000);
  const first = await root.nodes[0].loadChildren({limit: 64});
  assert.equal(first.nodes.length, 64);
  assert.equal(first.total, 10000);
  assert.equal(first.hasMore, true);
  const last = await root.nodes[0].loadChildren({offset: 9990, limit: 64});
  assert.equal(last.nodes.length, 10);
  assert.equal(last.hasMore, false);
  const viewport = model.window({count: 10000, scrollTop: 24000, viewportHeight: 480});
  assert(viewport.count <= 32);
  assert(viewport.before > 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.loadChildren('src', {signal: controller.signal}), error => error.name === 'AbortError');
  await assert.rejects(model.loadChildren('src', {limit: 1001}));
  model.dispose();
});

test('A24 deferred explorer construction materializes no files before cancellable expansion', async () => {
  const files = Array.from({length: 10000}, (_, index) => ({path: `src/F${index}.cs`}));
  const model = new LazyExplorerTree({files, deferIndex: true});
  assert.equal(model.files.size, 0);
  assert.equal(model.root.childCount, null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.root.loadChildren({signal: controller.signal}), error => error.name === 'AbortError');
  assert.equal(model.files.size, 0);
  const page = await model.root.loadChildren();
  assert.equal(page.nodes[0].childCount, 10000);
  assert.equal(model.root.childCount, 1);
  model.dispose();
});
