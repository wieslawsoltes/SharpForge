import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorHeap, finishCollection} from './a06-collector-fixtures.js';

function chainHeap() {
  const heap = collectorHeap({gcStress: false});
  const leaf = heap.object('Leaf', []);
  const tail = heap.object('Link', [leaf]);
  const head = heap.object('Link', [tail]);
  heap.rootProvider = () => [head];
  return {heap, head, tail, leaf};
}

test('single-reference full marking charges object starts and edges with budgets one and two', () => {
  for (const budget of [1, 2]) {
    const {heap, head, tail, leaf} = chainHeap();
    heap.startIncremental({generation: 2});
    const first = heap.step(budget);
    assert.equal(first.work, budget);
    assert.equal(heap.collector.marker.statistics.scannedObjects, 1);
    assert.equal(heap.collector.marker.statistics.edgesScanned, budget - 1);
    if (budget === 1) {
      assert.equal(heap.collector.marker.cursor.handle, head.h);
      assert.equal(heap.collector.marker.cursor.next, 0);
      assert.equal(heap.collector.marker.color(head), 1);
      assert.equal(heap.collector.marker.color(tail), 0);
    } else {
      assert.equal(heap.collector.marker.cursor, null);
      assert.equal(heap.collector.marker.color(head), 2);
      assert.equal(heap.collector.marker.color(tail), 1);
    }
    const result = finishCollection(heap, budget);
    assert.equal(result.markedObjects, 3);
    assert.equal(result.scannedObjects, 3);
    assert.equal(result.edgesScanned, 2);
    assert.equal(result.sweepSlots, 0);
    assert.equal(result.freedThisCollection, 0);
    for (const reference of [head, tail, leaf]) assert(heap.tryGet(reference));
  }
});

test('single-reference bitmap marking reads its nonzero field and ignores non-reference slots', () => {
  const heap = collectorHeap({gcStress: false});
  heap.methodTables.define({name: 'TypedLink', fields: [
    {name: 'Count', type: 'int'}, {name: 'Next', type: 'Node'}, {name: 'Other', type: 'int'}
  ]});
  const child = heap.object('Node', []);
  const ignored = heap.object('Ignored', []);
  const views = heap.spaces.arrayViews;
  const create = views.create;
  views.create = function(binding) {
    return new Proxy(create.call(this, binding), {
      get() { throw new Error('canonical Array view was read'); }
    });
  };
  let owner;
  try {
    owner = heap.object('TypedLink', [7, child, 9]);
  } finally {
    views.create = create;
  }
  const record = heap.get(owner);
  assert.equal(record.descriptor.scan, 'bitmap');
  assert.deepEqual(record.descriptor.referenceSlots, [1]);
  record.data[0] = ignored;
  assert.throws(() => record.data[1], /canonical Array view was read/);
  heap.rootProvider = () => [owner];
  heap.startIncremental({generation: 2});
  assert.equal(heap.step(2).work, 2);
  assert.equal(heap.collector.marker.color(owner), 2);
  assert.equal(heap.collector.marker.color(child), 2);
  assert.equal(heap.collector.marker.color(ignored), 0);
  const result = finishCollection(heap, 2);
  assert.equal(result.edgesScanned, 1);
  assert.equal(result.markedObjects, 2);
  assert.equal(heap.tryGet(ignored), null);
  assert(heap.tryGet(child));
});

test('single-reference marking snapshots resume both a partial cursor and a completed owner', () => {
  for (const prefix of [1, 2]) {
    const {heap, head, tail} = chainHeap();
    heap.startIncremental({generation: 2});
    heap.step(prefix);
    const snapshot = heap.snapshot();
    const expected = finishCollection(heap, 2);
    heap.restore(snapshot);
    assert.equal(heap.collector.marker.color(head), prefix === 1 ? 1 : 2);
    assert.equal(heap.collector.marker.color(tail), prefix === 1 ? 0 : 1);
    const resumed = heap.step(prefix === 1 ? 1 : 2);
    assert.equal(resumed.work, prefix === 1 ? 1 : 2);
    const actual = finishCollection(heap, 1);
    for (const field of ['markedObjects', 'scannedObjects', 'edgesScanned', 'freedThisCollection', 'liveBytes', 'sweepSlots']) {
      assert.equal(actual[field], expected[field], field);
    }
  }
});

test('single-reference child marking activates dependent chains and complete block liveness', () => {
  const heap = collectorHeap({gcStress: false, blockSize: 2});
  const key = heap.object('Key', []);
  const second = heap.object('SecondKey', []);
  const value = heap.array('int', 8);
  const owner = heap.object('Link', [key]);
  heap.createHandle(key, {kind: 'Dependent', secondary: second});
  heap.lifetime.createDependentHandle(second, value);
  heap.rootProvider = () => [owner];
  heap.startIncremental({generation: 2});
  heap.step(2);
  const result = finishCollection(heap, 2);
  assert.equal(result.markedObjects, 4);
  assert.equal(result.scannedObjects, 4);
  assert.equal(result.edgesScanned, 1);
  assert.equal(result.sweepBlocks, 0);
  assert.equal(result.sweepSlots, 0);
  assert.equal(result.freedThisCollection, 0);
  assert.equal(result.lifetime.dependentMarked, 2);
  assert(heap.tryGet(value));
});

function observedPayload(accessor, budget) {
  const heap = collectorHeap({gcStress: false});
  const busy = heap.object('Busy', [null, null, null]);
  const child = heap.object('Leaf', []);
  const owner = heap.object('Link', [child]);
  const record = heap.get(owner);
  const calls = {data: 0, length: 0, index: 0};
  const payload = new Proxy([child], {
    get(target, property, receiver) {
      if (property === 'length') calls.length++;
      if (property === '0') calls.index++;
      return Reflect.get(target, property, receiver);
    }
  });
  if (accessor) {
    Object.defineProperty(record, 'data', {configurable: true, enumerable: true,
      get() { calls.data++; return payload; }});
  } else record.data = payload;
  heap.rootProvider = () => [busy, owner];
  heap.startIncremental({generation: 2});
  assert.deepEqual(calls, {data: 0, length: 0, index: 0});
  heap.step(budget);
  if (budget === 1) heap.step(1);
  assert.equal(heap.collector.marker.color(owner), 2);
  assert.equal(heap.collector.marker.color(child), 2);
  assert.equal(heap.collector.marker.statistics.edgesScanned, 1);
  const observed = {...calls};
  finishCollection(heap, 2);
  assert(heap.tryGet(child));
  return observed;
}

test('single-reference probes leave host replacement and accessor observation to the generic visitor', () => {
  for (const accessor of [false, true]) {
    const generic = observedPayload(accessor, 1);
    const candidate = observedPayload(accessor, 2);
    assert.equal(generic.index, 1);
    assert.equal(generic.length, 1);
    assert.equal(generic.data > 0, accessor);
    assert.deepEqual(candidate, generic, 'declining the fast path must not observe the payload again');
  }
});

test('single-reference old owners retain their remembered-set scanning in a minor collection', () => {
  const heap = collectorHeap({gcStress: false, generational: true});
  const owner = heap.object('Link', [null]);
  heap.rootProvider = () => [owner];
  heap.collect();
  heap.collect();
  assert.equal(heap.getGeneration(owner), 2);
  const child = heap.object('Leaf', []);
  heap.writeField(owner, 0, child);
  heap.startIncremental({generation: 0});
  assert.equal(heap.step(2).work, 2);
  const result = finishCollection(heap, 2);
  assert.equal(result.generation, 0);
  assert.equal(result.rememberedEdgesScanned, 1);
  assert.equal(result.ownersScanned, 1);
  assert.equal(heap.collector.cards.cards.size, 1);
  assert.equal(heap.getGeneration(child), 1);
  assert(heap.tryGet(child));
});

test('single-reference shortcuts preserve descriptor ownership faults with both budgets', () => {
  for (const budget of [1, 2]) {
    const foreignHeap = collectorHeap({gcStress: false});
    const foreign = foreignHeap.object('Link', [null]);
    const heap = collectorHeap({gcStress: false});
    const owner = heap.object('Link', [null]);
    const record = heap.get(owner);
    const descriptor = record.descriptor;
    record.descriptor = foreignHeap.get(foreign).descriptor;
    heap.rootProvider = () => [owner];
    heap.startIncremental({generation: 2});
    if (budget === 1) assert.equal(heap.step(1).work, 1);
    assert.throws(() => heap.step(budget), {name: 'InvalidReferenceException'});
    assert.equal(heap.collector.marker.color(owner), 1);
    assert.equal(heap.collector.marker.cursor.handle, owner.h);
    record.descriptor = descriptor;
    assert.equal(finishCollection(heap, 2).freedThisCollection, 0);
  }
});

test('single-reference tracing resumes its owner when a stored host reference getter throws', () => {
  const heap = collectorHeap({gcStress: false});
  const busy = heap.object('Busy', [null, null, null]);
  const child = heap.object('Leaf', []);
  const owner = heap.object('Link', [child]);
  const failure = new Error('reference identity read failed');
  let armed = true;
  heap.get(owner).data[0] = new Proxy(child, {
    get(target, property, receiver) {
      if (armed && property === 'h') throw failure;
      return Reflect.get(target, property, receiver);
    }
  });
  heap.rootProvider = () => [busy, owner];
  heap.startIncremental({generation: 2});
  assert.throws(() => heap.step(2), error => error === failure);
  assert.equal(heap.collector.marker.cursor.handle, owner.h);
  assert.equal(heap.collector.marker.cursor.next, 0);
  assert.equal(heap.collector.marker.color(owner), 1);
  armed = false;
  assert.equal(heap.step(1).work, 1);
  assert.equal(heap.collector.marker.color(owner), 2);
  const result = finishCollection(heap, 2);
  assert.equal(result.scannedObjects, 3);
  assert.equal(result.edgesScanned, 4);
  assert.equal(result.freedThisCollection, 0);
  assert(heap.tryGet(child));
});

test('single-reference owners remain pending through a reference getter that collects and then throws', () => {
  for (const budget of [1, 2]) {
    const heap = collectorHeap({gcStress: false});
    const child = heap.object('Leaf', []);
    const owner = heap.object('Link', [child]);
    const failure = new Error('reference getter collected');
    let armed = true;
    heap.get(owner).data[0] = new Proxy(child, {
      get(target, property, receiver) {
        if (armed && property === 'h') {
          armed = false;
          heap.collect();
          throw failure;
        }
        return Reflect.get(target, property, receiver);
      }
    });
    heap.rootProvider = () => [owner];
    heap.startIncremental({generation: 2});
    if (budget === 1) assert.equal(heap.step(1).work, 1);
    assert.throws(() => heap.step(budget), error => error === failure);
    assert(heap.tryGet(owner));
    assert(heap.tryGet(child), 'the nested collection must see the still-pending owner edge');
    assert.equal(heap.collector.phase, 'idle');
    assert.equal(heap.collector.marker.cursor, null);
    assert.equal(heap.stats.collections, 1);
    assert.equal(heap.collector.lastResult.markedObjects, 2);
    assert.equal(heap.collect().freedThisCollection, 0);
  }
});
