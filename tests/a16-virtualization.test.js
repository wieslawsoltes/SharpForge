import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemSizeIndex, RealizationWindow, ItemsRepeater, ItemsStackPanel, ItemsWrapGrid,
  IncrementalLoader, LinedFlowLayout } from '../packages/winui-controls/src/virtualization/index.js';

const source = count => ({ count, getAt: index => ({ id: index, text: 'Item ' + index }), keyAt: index => index });

test('million-item realization stays bounded and variable-size offsets are indexed', () => {
  const window = new RealizationWindow({ count: 1000000, estimatedSize: 10 });
  const range = window.update(5000000, 400);
  assert.ok(range.end - range.start <= 121);
  assert.equal(range.extent, 10000000);
  const index = new ItemSizeIndex(1000000, 10);
  index.setSize(1, 20);
  index.setSize(100, 50);
  assert.equal(index.offsetOf(101), 1060);
  assert.equal(index.indexAt(1060), 101);
  assert.throws(() => index.setSize(0, 0));
  assert.throws(() => index.setSize(1000000, 1));
});

test('measurement above viewport preserves anchor position and source identity', () => {
  const window = new RealizationWindow({ count: 1000, estimatedSize: 10, keyAt: index => 'key-' + index });
  window.update(1000, 100);
  window.measure(0, 20);
  assert.equal(window.offset, 1010);
  assert.equal(window.anchor.key, 'key-100');
  window.sourceChanged(1001, { anchorIndex: 101 });
  assert.equal(window.anchor.index, 101);
});

test('repeater clears recycled identity and pins at most one focused item', () => {
  const items = source(1000000);
  const cleared = [];
  let created = 0;
  const repeater = new ItemsRepeater({ source: items, layout: new ItemsStackPanel({ source: items, estimatedSize: 20 }),
    createElement: () => ({ serial: ++created }), prepareElement: (container, item) => { container.key = item.key; },
    clearElement: (container, item) => { cleared.push(item.key); delete container.key; }, disposeElement() {} });
  const first = repeater.update({ x: 0, y: 0, width: 100, height: 100 });
  repeater.focusedKey = first.elements[0].key;
  const pinned = first.elements[0].element;
  const second = repeater.update({ x: 0, y: 10000, width: 100, height: 100 });
  assert.equal(repeater.pool.active.get(repeater.focusedKey).container, pinned);
  assert.ok(created <= first.elements.length + second.elements.length);
  assert.ok(cleared.length > 0);
  assert.ok(repeater.pool.active.size <= second.elements.length + 1);
  repeater.dispose();
  assert.equal(repeater.pool.active.size, 0);
  assert.throws(() => repeater.update({ x: 0, y: 0, width: 1, height: 1 }), /disposed/);
});

test('uniform and lined flow layouts have bounded realization and deterministic placement', async () => {
  const items = source(1000000);
  const grid = new ItemsWrapGrid({ source: items, itemWidth: 50, itemHeight: 20 });
  const result = grid.arrange({ x: 0, y: 10000, width: 200, height: 100 });
  assert.equal(result.columns, 4);
  assert.ok(result.items.length <= 64);
  const flow = new LinedFlowLayout({ source: source(20), lineHeight: 20, minimumItemSpacing: 0, lineSpacing: 0 });
  assert.throws(() => flow.arrange({ x: 0, y: 0, width: 100, height: 40 }), /prepare/);
  let yields = 0;
  await flow.prepare(100, { chunkSize: 5, yieldWork: async () => { yields++; } });
  assert.equal(yields, 4);
  assert.equal(flow.arrange({ x: 0, y: 0, width: 100, height: 40 }).extent.height, 80);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(flow.prepare(100, { signal: controller.signal }), { name: 'AbortError' });
});

test('incremental loading coalesces concurrent requests, reports failures and aborts disposal', async () => {
  let loads = 0;
  let finish;
  let signal;
  const items = { count: 10, HasMoreItems: true, LoadMoreItemsAsync(count, options) {
    loads++;
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  } };
  const loader = new IncrementalLoader(items);
  const first = loader.nearEnd({ start: 0, end: 10 });
  const second = loader.nearEnd({ start: 0, end: 10 });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(loads, 1);
  loader.dispose();
  assert.equal(signal.aborted, true);
  finish({ Count: 10 });
  await first;
  const errors = [];
  const failing = new IncrementalLoader({ count: 0, LoadMoreItemsAsync() { throw new Error('failure'); } },
    { onError: error => errors.push(error.message) });
  await assert.rejects(failing.nearEnd({ start: 0, end: 0 }), /failure/);
  assert.deepEqual(errors, ['failure']);
});
