import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';
import {createCapacityHost, capacityState, capacityIterator, observeCapacityIterator} from './helpers/hashset-capacity.js';

function seeded(engine, element = 'int') {
  const host = createCapacityHost(engine, {element, constructor: {kind: 'capacity', capacity: 29}});
  for (const value of [10, 20, 30]) host.call('Add', host.platform.managed(element === 'string' ? String(value) : value, element));
  host.call('Remove', host.platform.managed(element === 'string' ? '20' : 20, element));
  return host;
}

function metadata(host) {
  return Object.fromEntries(['$data', '$slots', '$used', '$free', '$count', '$version']
    .map(key => [key, host.platform.get(host.reference, key)]));
}

for (const engine of ['source', 'cil']) {
  test(`SF-A08-T13 ${engine}: rejected and rounded no-op capacity calls allocate nothing and preserve enumeration`, () => {
    const host = createCapacityHost(engine, {constructor: {kind: 'capacity', capacity: 7}});
    try {
      for (const value of [10, 20, 30]) host.call('Add', value);
      const iterator = capacityIterator(host);
      const before = metadata(host);
      const {heap} = host.platform;
      const allocations = heap.stats.allocations;
      const budget = heap.maxBytes;
      let writes = 0;
      host.vm.onWrite = () => writes++;
      try {
        heap.maxBytes = 1;
        assert.equal(host.call('EnsureCapacity', 7), 7);
        host.call('TrimExcess', 4);
        host.call('TrimExcess', 2147483647);
        assert.throws(() => host.call('EnsureCapacity', -1), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => host.call('TrimExcess', 2), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => host.call('EnsureCapacity', 968898), {name: 'OutOfMemoryException'});
        assert.deepEqual(metadata(host), before);
        assert.equal(writes, 0);
        assert.equal(heap.stats.allocations, allocations);
      } finally { heap.maxBytes = budget; host.vm.onWrite = null; }
      assert.deepEqual(observeCapacityIterator(host, iterator), {moved: true, current: 10, fault: null});
    } finally { host.stop(); }
  });

  test(`SF-A08-T13 ${engine}: failed backing allocation retains contents while TrimExcess advances its native version`, () => {
    for (const operation of ['EnsureCapacity', 'TrimExcess']) {
      for (const stage of ['object[]', 'int[]', 'owner']) {
        const host = seeded(engine);
        const {heap} = host.platform;
        const allocate = heap.allocate;
        const replaceData = heap.replaceData;
        const before = metadata(host);
        const state = capacityState(host);
        const iterator = capacityIterator(host);
        const pins = heap.pins.length;
        const failure = new ManagedFault('OutOfMemoryException', 'Injected allocation failure: ' + stage);
        try {
          heap.allocate = function(kind, type, ...args) {
            if (type === stage) throw failure;
            return allocate.call(this, kind, type, ...args);
          };
          heap.replaceData = function(reference, values) {
            if (stage === 'owner' && reference.h === host.reference.h) throw failure;
            return replaceData.call(this, reference, values);
          };
          try {
            assert.throws(() => operation === 'EnsureCapacity' ? host.call(operation, 37) : host.call(operation), error => error === failure);
          } finally { heap.allocate = allocate; heap.replaceData = replaceData; }
          assert.deepEqual(capacityState(host), state);
          assert.deepEqual(metadata(host), {...before, '$version': before.$version + (operation === 'TrimExcess' ? 1 : 0)});
          assert.equal(heap.pins.length, pins);
          assert.deepEqual(observeCapacityIterator(host, iterator), operation === 'TrimExcess'
            ? {moved: false, current: null, fault: 'System.InvalidOperationException'} : {moved: true, current: 10, fault: null});
          assert.equal(Boolean(host.platform.native(host.call('Remove', 30))), true);
          assert.deepEqual(capacityState(host).values, [10]);
        } finally { heap.allocate = allocate; heap.replaceData = replaceData; host.stop(); }
      }
    }
  });

  test(`SF-A08-T13 ${engine}: successful growth keeps holes, free-slot order, cached positions and enumerator version`, () => {
    const host = seeded(engine);
    try {
      const {platform, reference} = host;
      const record = platform.record(reference);
      const index = platform.bclIndexes.get(record).index;
      const before = metadata(host);
      assert.equal(host.call('EnsureCapacity', 37), 37);
      assert.equal(platform.get(reference, '$version'), before.$version);
      assert.equal(platform.get(reference, '$used'), before.$used);
      assert.equal(platform.get(reference, '$free'), before.$free);
      assert.strictEqual(platform.bclIndexes.get(record).index, index);
      host.call('Add', 40);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 3, values: [10, 40, 30]});
    } finally { host.stop(); }
  });

  test(`SF-A08-T13 ${engine}: a version observer's old-position cache is invalidated before compacted storage notifications`, () => {
    const host = seeded(engine);
    let observed = false;
    try {
      host.vm.onWrite = event => {
        if (event.property === '$version') {
          observed = true;
          assert.equal(Boolean(host.platform.native(host.call('Contains', 30))), true);
        }
      };
      host.call('TrimExcess');
      host.vm.onWrite = null;
      assert.equal(observed, true);
      assert.equal(Boolean(host.platform.native(host.call('Remove', 30))), true);
      assert.deepEqual(capacityState(host), {capacity: 3, count: 1, values: [10]});
    } finally { host.vm.onWrite = null; host.stop(); }
  });

  test(`SF-A08-T13 ${engine}: mutating version observers are revalidated against fresh backing and counts`, () => {
    for (const mutation of ['Add', 'EnsureCapacity']) {
      const host = createCapacityHost(engine, {constructor: {kind: 'capacity', capacity: 7}});
      let observed = false;
      try {
        for (const value of [10, 20, 30]) host.call('Add', value);
        host.vm.onWrite = event => {
          if (event.property !== '$version' || observed) return;
          observed = true;
          host.call(mutation, mutation === 'Add' ? 40 : 37);
        };
        if (mutation === 'Add') assert.throws(() => host.call('TrimExcess'), {name: 'ArgumentOutOfRangeException'});
        else host.call('TrimExcess');
        host.vm.onWrite = null;
        const expected = mutation === 'Add'
          ? {capacity: 7, count: 4, values: [10, 20, 30, 40]} : {capacity: 3, count: 3, values: [10, 20, 30]};
        assert.equal(observed, true);
        assert.deepEqual(capacityState(host), expected);
        assert.equal(host.platform.heap.get(host.platform.get(host.reference, '$slots')).data.length, expected.capacity);
      } finally { host.vm.onWrite = null; host.stop(); }
    }
  });

  test(`SF-A08-T13 ${engine}: old and new arrays and live strings survive collection throughout notification delivery`, () => {
    const host = seeded(engine, 'string');
    const {heap} = host.platform;
    const before = metadata(host);
    const weakData = heap.createHandle(before.$data, {weak: true});
    const weakSlots = heap.createHandle(before.$slots, {weak: true});
    const pins = heap.pins.length;
    const notifications = [];
    try {
      host.vm.onWrite = event => {
        heap.collect();
        if (event.property === '$data' || event.property === '$slots') {
          assert.equal(heap.get(event.oldValue).kind, 'array');
          assert.equal(heap.get(event.value).kind, 'array');
          notifications.push(event.property);
        }
        assert.deepEqual(capacityState(host).values, ['10', '30']);
      };
      host.call('TrimExcess');
      host.vm.onWrite = null;
      assert.deepEqual(notifications, ['$data', '$slots']);
      assert.equal(heap.pins.length, pins);
      assert.deepEqual(capacityState(host), {capacity: 3, count: 2, values: ['10', '30']});
      heap.collect();
      assert.equal(heap.getHandle(weakData), null);
      assert.equal(heap.getHandle(weakSlots), null);
    } finally {
      host.vm.onWrite = null;
      heap.releaseHandle(weakData);
      heap.releaseHandle(weakSlots);
      host.stop();
    }
  });

  test(`SF-A08-T13 ${engine}: observer exceptions retain the appropriate completed state and release temporary roots`, () => {
    for (const property of ['$version', '$data']) {
      const host = seeded(engine);
      const before = metadata(host);
      const pins = host.platform.heap.pins.length;
      const failure = new Error('Observer failure at ' + property);
      try {
        host.vm.onWrite = event => { if (event.property === property) throw failure; };
        assert.throws(() => host.call('TrimExcess'), error => error === failure);
        host.vm.onWrite = null;
        assert.deepEqual(capacityState(host), {capacity: property === '$data' ? 3 : 29, count: 2, values: [10, 30]});
        assert.equal(host.platform.get(host.reference, '$version'), before.$version + 1);
        assert.equal(host.platform.heap.pins.length, pins);
        assert.equal(Boolean(host.platform.native(host.call('Remove', 30))), true);
        assert.deepEqual(capacityState(host).values, [10]);
      } finally { host.vm.onWrite = null; host.stop(); }
    }
  });

  test(`SF-A08-T13 ${engine}: heap restoration recovers capacities, holes and free slots independently across VMs`, () => {
    const first = seeded(engine);
    const second = createCapacityHost(engine, {constructor: {kind: 'capacity', capacity: 7}});
    try {
      second.call('Add', 99);
      const snapshot = first.platform.heap.snapshot();
      const before = metadata(first);
      first.call('TrimExcess');
      first.call('Add', 40);
      first.call('EnsureCapacity', 89);
      first.platform.heap.restore(snapshot);
      assert.deepEqual(metadata(first), before);
      assert.deepEqual(capacityState(first), {capacity: 29, count: 2, values: [10, 30]});
      first.call('Add', 50);
      assert.deepEqual(capacityState(first).values, [10, 50, 30]);
      first.call('TrimExcess');
      assert.deepEqual(capacityState(second), {capacity: 7, count: 1, values: [99]});
    } finally { first.stop(); second.stop(); }
  });

  test(`SF-A08-T13 ${engine}: a restored legacy dense layout keeps its recorded capacity until a requested resize`, () => {
    const host = createCapacityHost(engine);
    const {platform, reference} = host;
    try {
      const storage = platform.heap.allocate('array', 'object[]', [10, 20, null, null]);
      platform.heap.replaceData(reference, ['$data', storage, '$count', 2, '$version', 0]);
      host.call('Remove', 10);
      assert.deepEqual(capacityState(host), {capacity: 4, count: 1, values: [20]});
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(host.call('EnsureCapacity', 5), 7);
      host.call('Add', 30);
      assert.deepEqual(capacityState(host), {capacity: 7, count: 2, values: [30, 20]});
    } finally { host.stop(); }
  });

  test(`SF-A08-T13 ${engine}: Dictionary retains its existing growth, backing and free-slot path`, () => {
    const host = createClosedCollection(engine, 'Dictionary', 'int, int');
    const {platform, reference, call} = host;
    const handle = platform.heap.createHandle(reference);
    try {
      for (let value = 0; value < 8; value++) call('Add', value, value * 10);
      const storage = platform.get(reference, '$data');
      assert.equal(platform.heap.get(storage).data.length, 16);
      const index = platform.bclIndexes.get(platform.record(reference)).index;
      const allocations = platform.heap.stats.allocations;
      call('Remove', 3);
      call('Add', 9, 90);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.strictEqual(platform.bclIndexes.get(platform.record(reference)).index, index);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(call('get_Item', 9), 90);
      assert.equal(call('get_Count'), 8);
    } finally { platform.heap.releaseHandle(handle); host.vm.stop(); }
  });
}
