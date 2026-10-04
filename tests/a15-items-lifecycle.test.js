import test from 'node:test';
import assert from 'node:assert/strict';
import {ItemContainerGenerator, ItemsSourceController, CollectionView, CollectionViewSource} from '@sharpforge/winui-properties';
import {ItemIdentities} from '../packages/winui-properties/src/items/item-identities.js';

function fixture(options = {}) {
  const events = [], scheduled = [], owner = {}, containers = [];
  const adapter = {
    identity: value => value.id,
    createContainer: () => { const value = {id: containers.length + 1}; containers.push(value); return value; },
    resetContainer: value => { value.reset = (value.reset ?? 0) + 1; },
    setDataContext: (value, item) => { value.data = item; },
    prepareContent: (value, item) => ({dispose: () => events.push(['dispose', value.id, item])}),
    prepareContainerForItem: (value, item, index) => events.push(['prepare', value.id, item, index]),
    clearContainerForItem: (value, item) => events.push(['clear', value.id, item]),
    disposeContainer: value => { value.disposed = true; },
    indexChanged: (value, index) => { value.index = index; },
    ...options.adapter
  };
  const generator = new ItemContainerGenerator({...options, owner, adapter, schedule: callback => scheduled.push(callback)});
  return {generator, adapter, owner, events, scheduled, containers};
}

test('items: duplicate occurrences have distinct containers and stable keys through insert/move/recycle', () => {
  const {generator} = fixture();
  const item = {};
  generator.setItems([item, item, 'last']);
  const first = generator.realize(0), second = generator.realize(1);
  const key = generator.identities.keyAt(1);
  assert.notEqual(first, second);
  assert.equal(generator.containerFromItem(item), first);
  generator.insert(0, ['prefix']);
  assert.equal(generator.indexFromContainer({id: second.id}), 2);
  generator.move(2, 0);
  assert.equal(generator.identities.keyAt(0), key);
  assert.equal(generator.containerFromIndex(0), second);
  generator.recycle(0);
  assert.equal(generator.itemFromContainer(second), null);
  assert.equal(generator.realize(0), second);
  assert.equal(generator.identities.keyAt(0), key);
});

test('items: phase work is coalesced, ordered and invalidated by recycling', () => {
  const {generator, scheduled} = fixture();
  const phases = [], events = [];
  generator.onContentChanging((_sender, event) => {
    events.push([event.phase, event.inRecycleQueue]);
    if (event.inRecycleQueue) return;
    event.registerUpdateCallback((_owner, phase) => phases.push(phase.phase), 3);
    event.registerUpdateCallback((_owner, phase) => phases.push(phase.phase), 1);
  });
  generator.setItems(['first', 'second']);
  generator.realize(0);
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.deepEqual(phases, [1, 3]);
  assert.deepEqual(events, [[0, false]]);
  generator.realize(1);
  generator.recycle(1);
  scheduled.shift()();
  assert.deepEqual(phases, [1, 3]);
  assert.deepEqual(events.at(-1), [0, true]);
  generator.dispose();
  assert.equal(generator.phaseQueue.length, 0);
});

test('items: failed clearing cleans every old container and commits a coherent replacement', () => {
  const {generator, containers} = fixture({adapter: {
    clearContainerForItem: () => { throw new Error('clear callback failed'); }
  }});
  generator.adapter.createContainer = () => { const value = {id: containers.length + 1}; containers.push(value); return value; };
  generator.setItems(['a', 'b']);
  generator.realize(0); generator.realize(1);
  assert.throws(() => generator.setItems(['c']), AggregateError);
  assert.deepEqual(generator.items, ['c']);
  assert.equal(generator.byContainer.size, 0);
  assert.equal(generator.byItem.size, 0);
  assert.ok(containers.every(value => value.disposed));
});

test('items: snapshots share immutable source arrays and restore without preparing or clearing containers', () => {
  const {generator, events} = fixture();
  generator.setItems(['a', 'b', 'c']);
  const container = generator.realize(1), snapshot = generator.snapshot();
  assert.equal(snapshot.items, generator.items);
  generator.move(1, 0);
  assert.notEqual(snapshot.items, generator.items);
  const count = events.length;
  generator.restore(snapshot);
  assert.equal(generator.containerFromIndex(1), container);
  assert.deepEqual(generator.items, ['a', 'b', 'c']);
  assert.equal(events.length, count);
  generator.dispose({preserveValues: true});
  assert.equal(events.filter(value => value[0] === 'clear').length, 0);
});

test('items: own containers preserve their local data, while source roots are retained only once', () => {
  const own = {id: 77, data: 'local'};
  const {generator} = fixture({adapter: {identity: value => value.id, isItemItsOwnContainer: item => item === own}});
  generator.setItems([own]);
  const source = {h: 3, g: 1};
  generator.sourceReference = source;
  generator.realize(0);
  assert.equal(own.data, 'local');
  assert.ok([...generator.retainedValues()].includes(source));
  generator.recycle(0);
  assert.equal(own.data, 'local');
  assert.equal(own.disposed, undefined);
});

test('items: collection change deltas preserve unaffected containers and enforce source exclusivity', () => {
  const {generator} = fixture();
  const listeners = new Set();
  const source = {items: ['a', 'b', 'c'], subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }};
  const controller = new ItemsSourceController(generator);
  controller.setItemsSource(source);
  const container = generator.realize(2);
  source.items.splice(1, 1, 'x', 'y');
  for (const listener of listeners) listener({Action: 2, NewStartingIndex: 1, OldStartingIndex: 1, NewItems: ['x', 'y'], OldItems: ['b']});
  assert.deepEqual(generator.items, ['a', 'x', 'y', 'c']);
  assert.equal(generator.containerFromIndex(3), container);
  assert.throws(() => controller.add('manual'), {code: 'SFITEM010'});
  controller.setItemsSource(null);
  assert.equal(listeners.size, 0);
  controller.add('manual');
  assert.throws(() => controller.setItemsSource(source), {code: 'SFITEM009'});
  controller.clear();
  assert.equal(generator.items.length, 0);
});

test('items: grouped child mutations refresh the projection and current navigation is cancelable', () => {
  const subscribers = new Set();
  const children = ['first', 'second'];
  children.subscribe = listener => { subscribers.add(listener); return () => subscribers.delete(listener); };
  const source = new CollectionViewSource({source: [{items: children}, {items: []}], isSourceGrouped: true});
  assert.deepEqual(source.view.groups.map(group => [group.startIndex, group.count]), [[0, 2], [2, 0]]);
  assert.equal(source.view.moveCurrentTo('second'), true);
  const remove = source.view.onCurrentChanging(event => { if (event.isCancelable) event.cancel = true; });
  assert.equal(source.view.moveCurrentToFirst(), false);
  remove();
  children.unshift('new');
  for (const listener of subscribers) listener({action: 'Add'});
  assert.equal(source.view.currentItem, 'second');
  assert.equal(source.view.currentPosition, 2);
  source.dispose();
  assert.equal(subscribers.size, 0);
  const nullable = new CollectionView({items: [null, 'x']});
  nullable.moveCurrentToFirst(); nullable.reset([null, 'y']);
  assert.equal(nullable.currentPosition, 0);
});

test('items: bounds stop infinite input and identity runs remain compact for a million items', () => {
  const {generator} = fixture({maxItems: 4});
  const forever = { *[Symbol.iterator]() { while (true) yield 1; } };
  assert.throws(() => generator.setItems(forever), {code: 'SFITEM002'});
  assert.deepEqual(generator.items, []);
  const identities = new ItemIdentities();
  identities.reset(1000000);
  assert.equal(identities.runs.length, 1);
  const key = identities.keyAt(987654), snapshot = identities.snapshot();
  identities.move(987654, 5);
  assert.equal(identities.keyAt(5), key);
  identities.replace(10, 2, 3);
  assert.ok(identities.runs.length <= 8);
  identities.restore(snapshot);
  assert.equal(identities.keyAt(987654), key);
});
