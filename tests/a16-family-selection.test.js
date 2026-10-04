import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectionModel, SelectionMode, TreeViewModel, visibleItemRange } from '@sharpforge/winui-controls';

test('duplicate item occurrences retain separate identities and emit replacement selection', () => {
  const item = { id: 1 };
  const model = new SelectionModel({ items: [item, item, 'end'] });
  const changes = [];
  model.on('selectionChanged', value => changes.push(value));
  model.select(0);
  model.select(1);
  assert.equal(model.selectedIndex, 1);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[1].AddedItems, [item]);
  assert.deepEqual(changes[1].RemovedItems, [item]);
  const first = model.keyAt(0);
  const second = model.keyAt(1);
  assert.notEqual(first, second);
  model.setItems(['begin', item, item, 'end']);
  assert.equal(model.keyAt(1), first);
  assert.equal(model.keyAt(2), second);
  assert.equal(model.selectedIndex, 2);
});

test('extended selection uses a stable anchor across item reorder and snapshots', () => {
  const model = new SelectionModel({ items: ['a', 'b', 'c', 'd'], mode: SelectionMode.Extended });
  model.select(1);
  model.select(3, { range: true });
  assert.deepEqual(model.selectedRanges, [{ FirstIndex: 1, Length: 3 }]);
  const snapshot = model.snapshot();
  model.setItems(['c', 'a', 'd', 'b']);
  assert.deepEqual(model.selectedItems, ['c', 'd', 'b']);
  model.clear();
  model.restore(snapshot);
  assert.deepEqual(model.selectedItems, ['b', 'c', 'd']);
  model.select(0, { range: true });
  assert.deepEqual(model.selectedItems, ['a', 'b']);
});

test('selection mode transitions enforce bounds and single selection', () => {
  const model = new SelectionModel({ items: [0, 1, 2], mode: SelectionMode.Multiple });
  model.selectAll();
  assert.deepEqual(model.selectedIndices, [0, 1, 2]);
  model.setMode(SelectionMode.Single);
  assert.equal(model.selectedItems.length, 1);
  assert.throws(() => model.selectRange(0, 2), error => error.code === 'SFUI1604');
  assert.throws(() => model.select(3), error => error.code === 'SFUI1601');
  model.setMode(SelectionMode.None);
  assert.equal(model.selectedIndex, -1);
  assert.throws(() => model.setMode(27), error => error.code === 'SFUI1602');
});

test('a million uniform items realize a bounded interval', () => {
  const range = visibleItemRange(1_000_000, { scroll: 15_000_000, extent: 640, itemSize: 32 });
  assert.equal(range.last - range.first, 28);
  assert.equal(range.total, 32_000_000);
  assert.throws(() => visibleItemRange(1_000_001), error => error.code === 'SFUI1603');
  assert.throws(() => visibleItemRange(1, { itemSize: 0 }), error => error.code === 'SFUI1605');
});

test('tree traversal rejects cycles and shared children without recursive stack growth', () => {
  const leaf = { Content: 'leaf', Children: [] };
  assert.throws(() => new TreeViewModel({ roots: [{ Children: [leaf] }, { Children: [leaf] }] }),
    error => error.code === 'SFUI1611');
  const cycle = { Children: [] };
  cycle.Children.push(cycle);
  assert.throws(() => new TreeViewModel({ roots: [cycle] }), error => error.code === 'SFUI1611');
  const root = { Children: [] };
  let current = root;
  for (let index = 0; index < 5000; index++) {
    current.IsExpanded = true;
    current.Children.push({ Children: [] });
    current = current.Children[0];
  }
  const model = new TreeViewModel({ roots: [root] });
  assert.equal(model.visible().length, 5001);
  assert.equal(model.visible(), model.visible());
});

test('tree cascade selection computes mixed ancestors and restores graph state', () => {
  const a = { Content: 'a' };
  const b = { Content: 'b' };
  const root = { Content: 'root', Children: [a, b], IsExpanded: true };
  const model = new TreeViewModel({ roots: [root] });
  model.select(a, { multiple: true });
  assert.equal(model.checked(root), null);
  const snapshot = model.snapshot();
  model.select(root, { multiple: true, cascade: true });
  assert.equal(model.checked(root), true);
  model.collapse(root);
  model.restore(snapshot);
  assert.equal(model.checked(root), null);
  assert.equal(model.visible().length, 3);
});

test('a stale async expansion cannot mutate a collapsed or disposed tree', async () => {
  const root = { Children: [], HasUnrealizedChildren: true };
  const model = new TreeViewModel({ roots: [root] });
  let complete;
  const pending = model.expand(root, { load: () => new Promise(resolve => { complete = resolve; }) });
  await Promise.resolve();
  assert.throws(() => model.snapshot(), error => error.code === 'SFUI1615');
  model.collapse(root);
  complete([{ Content: 'late' }]);
  await pending;
  assert.equal(root.Children.length, 0);
  assert.equal(model.expanded.has(root), false);
  const next = model.expand(root, { load: async () => [{ Content: 'next' }] });
  model.dispose();
  await next;
  assert.equal(root.Children.length, 0);
});
