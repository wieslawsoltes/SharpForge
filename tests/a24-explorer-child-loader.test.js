import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '@sharpforge/controls';
import {ExplorerChildLoader} from '../apps/studio/explorer/child-loader.js';

function fixture(loadChildren) {
  const model = new TreeModel([{id: 'root', label: 'Root', branch: true, loadChildren}]);
  const abort = new AbortController();
  const updates = [];
  const loader = new ExplorerChildLoader({model, signal: abort.signal, onUpdate: value => updates.push(value)});
  return {model, loader, abort, updates};
}

test('late expansion cannot publish into a replacement workspace node with the same stable ID', async () => {
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  const app = fixture(() => { started.resolve(); return waiting.promise; });
  const pending = app.loader.expand(app.model.nodes.get('root'));
  await started.promise;
  const replacement = async () => [{id: 'current', label: 'Current'}];
  app.model.setNodes([{id: 'root', label: 'Other workspace', loadChildren: replacement, children: []}]);
  waiting.resolve([{id: 'stale', label: 'Stale'}]);
  await pending;
  assert.equal(app.model.nodes.has('stale'), false);
  assert.equal(app.updates.length, 0);
  await app.loader.expand(app.model.nodes.get('root'));
  assert.equal(app.model.nodes.has('current'), true);
});

test('duplicate expansions share one loader across TreeModel recloning and admit its children once', async () => {
  const waiting = Promise.withResolvers();
  let calls = 0;
  const app = fixture(() => { calls++; return waiting.promise; });
  const first = app.loader.expand(app.model.nodes.get('root'));
  app.model.setNodes(app.model.roots);
  const second = app.loader.expand(app.model.nodes.get('root'));
  assert.equal(first, second);
  waiting.resolve({nodes: [{id: 'first', label: 'First'}], offset: 0, hasMore: true});
  await first;
  assert.equal(calls, 1);
  assert.equal(app.model.nodes.get('root').children.length, 2);
  assert.equal(app.model.nodes.get('root:more:1').offset, 1);
  assert.equal(app.updates.length, 1);
});

test('duplicate load-more requests are coalesced and a retired parent cannot receive a page', async () => {
  let waiting = Promise.withResolvers();
  let started = Promise.withResolvers();
  let calls = 0;
  const app = fixture(({offset}) => {
    calls++;
    if (!offset) return {nodes: [{id: 'first', label: 'First'}], offset: 0, hasMore: true};
    started.resolve();
    return waiting.promise;
  });
  await app.loader.expand(app.model.nodes.get('root'));
  const more = app.model.nodes.get('root:more:1');
  const first = app.loader.loadMore(more), second = app.loader.loadMore(more);
  assert.equal(first, second);
  await started.promise;
  waiting.resolve({nodes: [{id: 'second', label: 'Second'}], offset: 1, hasMore: true});
  await first;
  assert.equal(calls, 2);
  assert.deepEqual(app.model.nodes.get('root').children.map(node => node.id), ['first', 'second', 'root:more:2']);
  assert.equal(app.updates.at(-1).reveal, true);
  waiting = Promise.withResolvers();
  started = Promise.withResolvers();
  const stale = app.loader.loadMore(app.model.nodes.get('root:more:2'));
  await started.promise;
  app.model.setNodes([{id: 'root', label: 'Replacement', loadChildren: async () => []}]);
  waiting.resolve({nodes: [{id: 'stale', label: 'Stale'}], offset: 2, hasMore: false});
  await stale;
  assert.equal(app.model.nodes.has('stale'), false);
});

test('invalid duplicate pages leave the prior tree intact and aborted expansions publish no children', async () => {
  const app = fixture(({offset}) => ({nodes: [{id: 'first', label: 'First'}], offset, hasMore: offset === 0}));
  await app.loader.expand(app.model.nodes.get('root'));
  const before = app.model.roots;
  const children = app.model.nodes.get('root').children;
  await assert.rejects(app.loader.loadMore(app.model.nodes.get('root:more:1')), /unique/);
  assert.equal(app.model.roots, before);
  assert.equal(app.model.nodes.get('root').children, children);
  assert.deepEqual(children.map(node => node.id), ['first', 'root:more:1']);
  const waiting = Promise.withResolvers(), started = Promise.withResolvers();
  const aborted = fixture(() => { started.resolve(); return waiting.promise; });
  const pending = aborted.loader.expand(aborted.model.nodes.get('root'));
  await started.promise;
  aborted.abort.abort();
  waiting.resolve([{id: 'late', label: 'Late'}]);
  await pending;
  assert.equal(aborted.model.nodes.has('late'), false);
  assert.equal(aborted.updates.length, 0);
});

test('a rejected retired loader is ignored while a current loader error remains visible', async () => {
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  const app = fixture(() => { started.resolve(); return waiting.promise; });
  const pending = app.loader.expand(app.model.nodes.get('root'));
  await started.promise;
  app.model.setNodes([{id: 'root', loadChildren: async () => { throw new Error('current failure'); }}]);
  waiting.reject(new Error('retired failure'));
  await pending;
  assert.equal(app.updates.length, 0);
  await assert.rejects(app.loader.expand(app.model.nodes.get('root')), /current failure/);
});
