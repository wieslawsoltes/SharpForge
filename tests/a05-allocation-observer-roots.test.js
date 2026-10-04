import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {CilVirtualMachine, ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function sourceMachine() {
  const compiled = compile('class Program { static void Main() {} }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return new VirtualMachine(compiled.image, {runtimeEvents: true});
}

const machines = [
  ['ManagedHeap', () => new ManagedHeap()],
  ['source VM', sourceMachine],
  ['CIL VM', () => new CilVirtualMachine(managedFixture(), {runtimeEvents: true})]
];

function withHeap(create, action) {
  const machine = create();
  const heap = machine.heap ?? machine;
  const observer = heap.allocationObserver;
  try {
    action(heap, machine.heap ? machine : null);
  } finally {
    heap.allocationObserver = observer;
    machine.stop?.();
  }
}

const allocations = [
  ['string', heap => ({
    allocate: () => heap.string('observed allocation'),
    data: 'observed allocation'
  })],
  ['array', heap => ({
    allocate: () => heap.array('int', 2),
    data: [0, 0]
  })],
  ['object', heap => {
    const child = heap.string('owned child');
    return {allocate: () => heap.object('System.Object', [child]), data: [child], child};
  }]
];

function explicitRootLifetime(heap, kind, throws) {
  const callerRoot = heap.string('caller root');
  const externalRoot = heap.string('explicit allocation root');
  const failure = new Error('explicit-root allocation observer failure');
  const before = heap.stats.collections;
  const iterator = (function* () { yield externalRoot; })();
  let iterations = 0;
  let notifications = 0;
  const roots = {[Symbol.iterator]() {
    iterations++;
    return iterator;
  }};
  heap.threshold = heap.stats.liveBytes;
  heap.allocationObserver = {allocation() {
    notifications++;
    assert.equal(heap.stats.collections, before + 1, 'reservation collected before notification');
    assert.equal(heap.get(externalRoot).data, 'explicit allocation root');
    heap.collect();
    assert.equal(heap.get(externalRoot).data, 'explicit allocation root');
    if (throws) throw failure;
  }};
  const initialPins = [...heap.pins];
  heap.withRoots([callerRoot], () => {
    const callerPins = [...heap.pins];
    const allocate = kind === 'string'
      ? () => heap.string('result without child references', roots)
      : () => heap.allocate('object', 'System.Object', [], roots);
    if (throws) assert.throws(allocate, error => error === failure);
    else {
      const result = heap.get(allocate());
      assert.equal(result.kind, kind);
      assert.deepEqual(result.data, kind === 'string' ? 'result without child references' : []);
    }
    assert.equal(notifications, 1);
    assert.equal(iterations, 1, 'the supplied one-shot iterable is consumed exactly once');
    assert.equal(heap.stats.collections, before + 2);
    assert.deepEqual(heap.pins, callerPins);
    assert.equal(heap.get(externalRoot).data, 'explicit allocation root');
    assert.equal(heap.collect().freedThisCollection, 2,
      'the explicit input and committed result become collectible after allocation returns or throws');
    assert.equal(heap.get(callerRoot).data, 'caller root');
    assert.throws(() => heap.get(externalRoot), {name: 'InvalidReferenceException'});
  });
  assert.deepEqual(heap.pins, initialPins);
}

for (const [engine, create] of machines) {
  for (const [kind, prepare] of allocations) {
    test(`${engine}: a committed ${kind} survives collection in its allocation observer`, () => {
      withHeap(create, heap => {
        const pending = prepare(heap);
        const pins = [...heap.pins];
        let notifications = 0;
        heap.allocationObserver = {allocation() {
          notifications++;
          heap.collect();
        }};
        const reference = pending.allocate();
        const record = heap.get(reference);
        assert.equal(record.kind, kind);
        if (kind === 'array') {
          assert.ok(record.data instanceof Int32Array);
          assert.equal(record.size, 40);
          assert.deepEqual(Array.from(record.data), pending.data);
        } else assert.deepEqual(record.data, pending.data);
        if (pending.child) assert.equal(heap.get(pending.child).data, 'owned child');
        assert.equal(notifications, 1);
        assert.deepEqual(heap.pins, pins);
        heap.collect();
        assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'});
        if (pending.child) assert.throws(() => heap.get(pending.child), {name: 'InvalidReferenceException'});
      });
    });
  }

  test(`${engine}: nested allocation notifications retain every unfinished allocation`, () => {
    withHeap(create, heap => {
      const pins = [...heap.pins];
      let nested = null;
      let notifications = 0;
      heap.allocationObserver = {allocation() {
        notifications++;
        heap.collect();
        if (notifications === 1) {
          nested = heap.string('nested allocation');
          assert.equal(heap.get(nested).data, 'nested allocation');
          // The inner allocation has returned; only its caller now supplies its root.
          heap.withRoots([nested], () => heap.collect());
        }
      }};
      const outer = heap.object('System.Object', []);
      assert.equal(heap.get(outer).type, 'System.Object');
      assert.equal(heap.get(nested).data, 'nested allocation');
      assert.equal(notifications, 2);
      assert.deepEqual(heap.pins, pins);
      assert.equal(heap.collect().freedThisCollection, 2);
      assert.throws(() => heap.get(outer), {name: 'InvalidReferenceException'});
      assert.throws(() => heap.get(nested), {name: 'InvalidReferenceException'});
    });
  });

  test(`${engine}: a throwing nested observer releases temporary roots and preserves caller roots`, () => {
    withHeap(create, heap => {
      const callerRoot = heap.string('caller root');
      const pins = [...heap.pins];
      const failure = new Error('synchronous allocation observer failure');
      let notifications = 0;
      heap.allocationObserver = {allocation() {
        notifications++;
        if (notifications === 1) heap.string('nested failure');
        else {
          heap.collect();
          throw failure;
        }
      }};
      heap.withRoots([callerRoot], () => {
        const callerPins = [...heap.pins];
        assert.throws(() => heap.object('System.Object', []), error => error === failure);
        assert.equal(notifications, 2);
        assert.deepEqual(heap.pins, callerPins);
        assert.equal(heap.get(callerRoot).data, 'caller root');
        assert.equal(heap.collect().freedThisCollection, 2,
          'both committed allocations become collectible after the observer unwinds');
        assert.equal(heap.get(callerRoot).data, 'caller root');
      });
      assert.deepEqual(heap.pins, pins);
      heap.collect();
      assert.throws(() => heap.get(callerRoot), {name: 'InvalidReferenceException'});
    });
  });

  for (const [kind, throws] of [['string', false], ['string', true], ['object', false], ['object', true]]) {
    test(`${engine}: one-shot roots survive reservation and ${throws ? 'throwing' : 'returning'} ${kind} notification`, () => {
      withHeap(create, heap => explicitRootLifetime(heap, kind, throws));
    });
  }

  for (const throws of [false, true]) {
    test(`${engine}: ${throws ? 'throwing' : 'returning'} growth observers retain the committed owner and children`, () => {
      withHeap(create, heap => {
        const owner = heap.object('System.Object', []);
        const child = heap.string('growth child');
        const weak = heap.createHandle(owner, {weak: true});
        const pins = [...heap.pins];
        const before = {...heap.stats};
        const failure = new Error('synchronous growth observer failure');
        const notifications = [];
        try {
          heap.allocationObserver = {allocation(bytes, growth) {
            notifications.push([bytes, growth]);
            assert.deepEqual(heap.get(owner).data, [child, child]);
            assert.equal(heap.get(owner).size, 48);
            heap.collect();
            assert.equal(heap.getHandle(weak), owner);
            assert.equal(heap.get(heap.get(owner).data[0]).data, 'growth child');
            if (throws) throw failure;
          }};
          const grow = () => heap.replaceData(owner, [child, child]);
          if (throws) assert.throws(grow, error => error === failure);
          else grow();
          assert.deepEqual(notifications, [[16, true]]);
          assert.deepEqual(heap.get(owner).data, [child, child]);
          assert.equal(heap.stats.allocations, before.allocations);
          assert.equal(heap.stats.allocatedBytes, before.allocatedBytes + 16);
          assert.deepEqual(heap.pins, pins);
          heap.collect();
          assert.equal(heap.getHandle(weak), null);
          assert.throws(() => heap.get(child), {name: 'InvalidReferenceException'});
        } finally {
          heap.releaseHandle(weak);
        }
      });
    });
  }
}

for (const [engine, create] of machines.slice(1)) {
  test(`${engine}: allocation observers remain synchronous while event subscribers remain deferred`, () => {
    withHeap(create, (heap, vm) => {
      const delivered = [];
      const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
      const cursor = vm.runtimeEvents.sequence;
      let observed = false;
      try {
        heap.allocationObserver = {allocation() {
          observed = true;
          assert.deepEqual(delivered, []);
          heap.collect();
        }};
        const reference = heap.string('deferred event delivery');
        assert.equal(observed, true);
        assert.equal(heap.get(reference).data, 'deferred event delivery');
        assert.deepEqual(delivered, []);
        const queued = vm.runtimeEvents.read({after: cursor});
        assert.deepEqual(queued.map(event => event.name), ['AllocationTick', 'GCStart', 'GCEnd']);
        vm.runSlice({instructionBudget: 0});
        assert.deepEqual(delivered, queued);
      } finally {
        unsubscribe();
      }
    });
  });
}
