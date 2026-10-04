import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewportItemSource, ViewportSelectionModel } from '../packages/winui-controls/src/items/viewport-source.js';
import { GroupedItemIndex, ViewportGroupIndex, SemanticZoomModel } from '../packages/winui-controls/src/items/grouping.js';

test('a million-item scene contains only realized values and compact selection ranges', () => {
  const source = new ViewportItemSource({ version: 1, count: 1_000_000, revision: 4,
    realized: [{ index: 10, item: 'a', key: 'occurrence:a' }, { index: 999_999, item: 'z', key: 'occurrence:z' }] });
  assert.equal(source.records.size, 2);
  assert.equal(source.getAt(500_000), undefined);
  const model = new ViewportSelectionModel();
  model.setItems(source);
  model.setMode(2);
  model.selectAll();
  assert.deepEqual(model.selectedRanges, [{ FirstIndex: 0, Length: 1_000_000 }]);
  assert.equal(model.isSelected(500_000), true);
  assert.deepEqual(model.selectedItems, ['a', 'z']);
  model.selectRange(100, 900_000, false);
  assert.deepEqual(model.selectedRanges, [{ FirstIndex: 0, Length: 100 }, { FirstIndex: 900_100, Length: 99_900 }]);
});

test('sparse source keys survive viewport replacement and malformed scenes are rejected', () => {
  const source = new ViewportItemSource({ version: 1, count: 20, revision: 1, realized: [{ index: 2, key: 'same', item: 'value' }] });
  source.update({ version: 1, count: 21, revision: 2, realized: [{ index: 3, key: 'same', item: 'value' }] });
  assert.equal(source.keyAt(3), 'same');
  assert.equal(source.indexOfKey('same'), 3);
  assert.throws(() => new ViewportItemSource({ version: 1, count: 1, realized: [{ index: 0 }, { index: 0 }] }));
  assert.throws(() => new ViewportItemSource({ version: 1, count: 1_000_001, realized: [] }));
  const model = new ViewportSelectionModel();
  assert.throws(() => model.setItems(new ViewportItemSource({ version: 1, count: 1, realized: [],
    selection: { current: 0, ranges: [{ FirstIndex: 0, Length: 2 }] } })), error => error.code === 'SFUI1603');
});

test('group indices retain actual group/header references and original selection indices', () => {
  const group = { $ref: 'group-a' };
  const header = { $ref: 'header-a' };
  const groups = new ViewportGroupIndex([{ index: 5, startIndex: 100, count: 20, group, header }], 1000);
  assert.equal(groups.groupAt(105).header, header);
  assert.equal(groups.groupAt(5), null);
  assert.equal(groups.indexOfKey({ $ref: 'group-a' }), 100);
  const runs = new GroupedItemIndex([{ Group: 'a' }, { Group: 'a' }, { Group: 'b' }]);
  assert.equal(runs.groupAt(2).first, 2);
  assert.throws(() => new ViewportGroupIndex([{ startIndex: 0, count: 3 }, { startIndex: 2, count: 1 }], 5));
});

test('semantic zoom moves the group anchor before completion and honors cancellation', () => {
  const order = [];
  const anchor = { $ref: 'group' };
  const model = new SemanticZoomModel({ capture: () => anchor, restore: (active, value) => order.push(['restore', active, value]) });
  model.on('ViewChangeCompleted', () => order.push(['complete']));
  assert.equal(model.toggle(), true);
  assert.deepEqual(order, [['restore', false, anchor], ['complete']]);
  const snapshot = model.snapshot();
  const remove = model.on('ViewChangeStarted', args => { args.Cancel = true; });
  assert.equal(model.toggle(), false);
  assert.equal(model.active, false);
  remove();
  model.toggle();
  model.restore(snapshot);
  assert.equal(model.anchor, anchor);
  assert.equal(model.active, false);
});
