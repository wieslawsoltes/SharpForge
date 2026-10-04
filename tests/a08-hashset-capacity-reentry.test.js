import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {createCapacityHost, capacityState} from './helpers/hashset-capacity.js';

function seeded(engine, capacity = 7) {
  const host = createCapacityHost(engine, {constructor: {kind: 'capacity', capacity}});
  for (const value of [10, 20, 30]) host.call('Add', value);
  return host;
}

function stored(host) {
  const fields = Object.fromEntries(['$data', '$slots', '$count', '$used', '$free', '$version']
    .map(name => [name, host.platform.get(host.reference, name)]));
  return {...capacityState(host), fields,
    slots: fields.$slots ? [...host.platform.heap.get(fields.$slots).data] : null};
}

function onAllocation(host, ordinal, action) {
  const heap = host.platform.heap;
  const previous = heap.allocationObserver;
  let allocations = 0;
  heap.allocationObserver = {allocation(_bytes, growth) {
    if (!growth && ++allocations === ordinal) action();
  }};
  return () => { heap.allocationObserver = previous; };
}

function conflict(error) {
  assert.equal(error.name, 'InvalidOperationException');
  assert.match(error.message, /^BCLHS0002:/);
  return true;
}

for (const engine of ['source', 'cil']) {
  test('SF-A08-T13 ' + engine + ': allocation reentry cannot publish stale values, counts, holes or capacity', () => {
    for (const ordinal of [1, 2]) {
      for (const operation of ['EnsureCapacity', 'TrimExcess']) {
        for (const mutation of ['Remove', 'Add', 'EnsureCapacity']) {
          const host = seeded(engine, 29);
          host.call('Remove', 20);
          let observed;
          const restore = onAllocation(host, ordinal, () => {
            host.call(mutation, mutation === 'Remove' ? 30 : mutation === 'Add' ? 40 : 89);
            observed = stored(host);
          });
          try {
            assert.throws(() => operation === 'EnsureCapacity' ? host.call(operation, 37) : host.call(operation), conflict);
            assert(observed, 'The selected allocation observer ran');
            assert.deepEqual(stored(host), observed, 'Keep the observer mutation and reject the prepared outer layout');
            assert.equal(host.platform.heap.pins.length, 0);
          } finally { restore(); host.stop(); }
        }
      }
    }
  });

  test('SF-A08-T13 ' + engine + ': unrelated same-heap mutations and nested allocation are allowed', () => {
    const host = seeded(engine);
    const other = host.root(host.platform.invoke(host.member('.ctor', ['int']), [7]));
    let observed = false;
    const restore = onAllocation(host, 1, () => {
      observed = true;
      host.platform.invoke(host.member('EnsureCapacity', ['int']), [other, 89]);
      host.platform.invoke(host.member('Add', ['int']), [other, 99]);
    });
    try {
      assert.equal(host.call('EnsureCapacity', 37), 37);
      assert.equal(observed, true);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 3, values: [10, 20, 30]});
      assert.equal(host.platform.invoke(host.member('get_Count', []), [other]), 1);
      assert.equal(host.platform.invoke(host.member('get_Capacity', []), [other]), 89);
      assert.equal(host.platform.heap.pins.length, 0);
    } finally { restore(); host.stop(); }
  });

  test('SF-A08-T13 ' + engine + ': allocation observer collection preserves every pending backing array', () => {
    for (const operation of ['EnsureCapacity', 'TrimExcess']) {
      const host = seeded(engine, 29);
      host.call('Remove', 20);
      const heap = host.platform.heap;
      const previous = heap.allocationObserver;
      let observed = 0;
      try {
        heap.allocationObserver = {allocation() { observed++; heap.collect(); }};
        if (operation === 'EnsureCapacity') assert.equal(host.call(operation, 37), 37);
        else host.call(operation);
        assert.equal(observed, 2);
        assert.deepEqual(capacityState(host), {capacity: operation === 'EnsureCapacity' ? 37 : 3, count: 2, values: [10, 30]});
        assert.equal(heap.pins.length, 0);
      } finally { heap.allocationObserver = previous; host.stop(); }
    }
  });

  test('SF-A08-T13 ' + engine + ': an owner-growth observer cannot silently replace the expected published state', () => {
    const host = createCapacityHost(engine);
    const heap = host.platform.heap;
    const previous = heap.allocationObserver;
    let observed;
    try {
      heap.allocationObserver = {allocation(_bytes, growth) {
        if (!growth || observed) return;
        host.call('Add', 40);
        observed = stored(host);
      }};
      assert.throws(() => host.call('EnsureCapacity', 37), conflict);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 1, values: [40]});
      assert.deepEqual(stored(host), observed);
      assert.equal(heap.pins.length, 0);
    } finally { heap.allocationObserver = previous; host.stop(); }
  });

  test('SF-A08-T13 ' + engine + ': compaction invalidates old positions before an owner-growth notification', () => {
    const host = seeded(engine, 29);
    host.call('Remove', 20);
    const {platform, reference, vm} = host;
    const record = platform.record(reference);
    // The released reader accepts a missing free-list head through its -1 fallback.
    platform.heap.replaceData(reference, record.data.filter((_value, index) => record.data[index - index % 2] !== '$free'));
    const previous = platform.heap.allocationObserver;
    let observed = false;
    try {
      vm.onWrite = event => {
        if (event.property === '$version' && !observed) host.call('Contains', 30);
      };
      platform.heap.allocationObserver = {allocation(_bytes, growth) {
        if (!growth || observed) return;
        observed = true;
        assert.equal(Boolean(platform.native(host.call('Remove', 30))), true);
      }};
      assert.throws(() => host.call('TrimExcess'), conflict);
      assert.equal(observed, true);
      assert.deepEqual(capacityState(host), {capacity: 3, count: 1, values: [10]});
      assert.equal(platform.heap.pins.length, 0);
    } finally { platform.heap.allocationObserver = previous; vm.onWrite = null; host.stop(); }
  });

  test('SF-A08-T13 ' + engine + ': natural completion permits host calls and a later explicit stop still cancels growth', () => {
    const host = seeded(engine);
    let atStop;
    const writes = [];
    let restore = () => {};
    try {
      assert.equal(host.vm.run().state, 'terminated');
      assert.equal(host.platform.bclHost.isExecutionStopped(host.platform), false);
      assert.equal(host.call('EnsureCapacity', 37), 37);
      assert.equal(Boolean(host.platform.native(host.call('Add', 40))), true);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 4, values: [10, 20, 30, 40]});
      restore = onAllocation(host, 1, () => {
        atStop = stored(host);
        host.vm.stop();
        host.vm.onWrite = event => writes.push(event);
      });
      assert.doesNotThrow(() => host.call('EnsureCapacity', 89));
      assert.equal(host.platform.bclHost.isExecutionStopped(host.platform), true);
      assert.deepEqual(stored(host), atStop);
      assert.deepEqual(writes, []);
      assert.equal(host.platform.heap.pins.length, 0);
    } finally { restore(); host.vm.onWrite = null; host.stop(); }
  });

  test('SF-A08-T13 ' + engine + ': constructor duplicate shrink keeps mutations from its early version observer', () => {
    const host = createCapacityHost(engine);
    const {platform, vm} = host;
    const input = host.root(platform.heap.allocate('array', 'int[]', [10, 10, 10, 10]));
    let observed = false;
    try {
      vm.onWrite = event => {
        if (event.property !== '$version' || event.value !== 2 || observed) return;
        observed = true;
        const reference = {h: event.handle, g: event.generation};
        platform.invoke(host.member('Remove', ['int']), [reference, 10]);
      };
      const reference = host.root(platform.invoke(host.member('.ctor', ['int[]']), [input]));
      vm.onWrite = null;
      assert.equal(observed, true);
      assert.equal(platform.invoke(host.member('get_Count', []), [reference]), 0);
      assert.equal(Boolean(platform.native(platform.invoke(host.member('Contains', ['int']), [reference, 10]))), false);
      assert.equal(Boolean(platform.native(platform.invoke(host.member('Add', ['int']), [reference, 10]))), true);
      assert.equal(platform.invoke(host.member('get_Count', []), [reference]), 1);
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; host.stop(); }
  });

  test('SF-A08-T13 ' + engine + ': stop during allocation cancels reserve callers before subsequent writes', () => {
    for (const operation of ['EnsureCapacity', 'TrimExcess', 'Add', 'UnionWith', 'capacity constructor', 'array constructor']) {
      for (const ordinal of [1, 2]) {
        const host = seeded(engine, operation === 'TrimExcess' ? 29 : 3);
        if (operation === 'TrimExcess') host.call('Remove', 20);
        const input = host.root(host.platform.heap.allocate('array', 'int[]', [40, 50]));
        const constructor = operation.endsWith('constructor');
        let atStop;
        const writes = [];
        const restore = onAllocation(host, ordinal + (constructor ? 1 : 0), () => {
          atStop = stored(host);
          host.vm.stop();
          host.vm.onWrite = event => writes.push(event);
        });
        try {
          assert.doesNotThrow(() => {
            if (operation === 'capacity constructor') host.platform.invoke(host.member('.ctor', ['int']), [7]);
            else if (operation === 'array constructor') host.platform.invoke(host.member('.ctor', ['int[]']), [input]);
            else if (operation === 'TrimExcess') host.call(operation);
            else host.call(operation, operation === 'EnsureCapacity' ? 37 : operation === 'Add' ? 40 : input);
          });
          assert(atStop, 'The selected allocation observer stopped execution');
          assert.equal(host.vm.state, 'terminated');
          assert.deepEqual(stored(host), atStop);
          assert.deepEqual(writes, [], 'No backing, element, count or version writes after stop');
          assert.equal(host.platform.heap.pins.length, 0);
        } finally { restore(); host.vm.onWrite = null; host.stop(); }
      }
    }
  });

  test('SF-A08-T13 ' + engine + ': version observer errors survive unless that observer explicitly stops execution', () => {
    for (const operation of ['TrimExcess', 'array constructor']) {
      for (const stop of [false, true]) {
        const host = seeded(engine, 29);
        const {platform, vm} = host;
        const input = host.root(platform.heap.allocate('array', 'int[]', []));
        const marker = new Error('version observer failure');
        const writes = [];
        let observed = false;
        try {
          vm.onWrite = event => {
            if (observed) { writes.push(event); return; }
            if (event.property !== '$version') return;
            observed = true;
            if (stop) vm.stop();
            throw marker;
          };
          const invoke = () => operation === 'TrimExcess' ? host.call(operation) :
            platform.invoke(host.member('.ctor', ['int[]']), [input]);
          if (stop) assert.doesNotThrow(invoke);
          else assert.throws(invoke, error => error === marker);
          assert.equal(observed, true);
          assert.equal(platform.bclHost.isExecutionStopped(platform), stop);
          assert.deepEqual(writes, []);
          assert.equal(platform.heap.pins.length, 0);
        } finally { vm.onWrite = null; host.stop(); }
      }
    }
  });

  test('SF-A08-T13 ' + engine + ': stop on version or backing notification prevents later resize and caller writes', () => {
    for (const property of ['$version', '$data', '$slots']) {
      const host = seeded(engine, property === '$version' ? 29 : 3);
      let atStop;
      const writes = [];
      try {
        host.vm.onWrite = event => {
          if (atStop) { writes.push(event); return; }
          if (event.property !== property) return;
          atStop = stored(host);
          host.vm.stop();
        };
        if (property === '$version') host.call('TrimExcess');
        else host.call('Add', 40);
        assert(atStop, 'The selected notification stopped execution');
        assert.equal(host.vm.state, 'terminated');
        assert.deepEqual(stored(host), atStop);
        assert.deepEqual(writes, []);
        assert.equal(host.platform.heap.pins.length, 0);
      } finally { host.vm.onWrite = null; host.stop(); }
    }
  });
}

for (const engine of ['source', 'cil']) {
  test('SF-A08-T13 ' + engine + ': a stopped framework constructor never resumes the guest or a retired caller stack', () => {
    const source = 'using System; using System.Collections.Generic; ' +
      'Console.WriteLine("armed"); var values = new HashSet<int>(7); Console.WriteLine("after");';
    const program = compileToIL(source, {pipeline: 'bound'});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
    const previous = vm.heap.allocationObserver;
    const writes = [];
    let stopped = false, retired;
    try {
      vm.onOutput = text => {
        if (!text.includes('armed')) return;
        vm.heap.allocationObserver = {allocation() {
          if (stopped) return;
          stopped = true;
          retired = vm.top;
          vm.stop();
          vm.onWrite = event => writes.push(event);
        }};
      };
      const result = vm.run();
      assert.equal(stopped, true);
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'armed\n');
      assert.equal(vm.fault, null);
      assert.equal(vm.frames.length, 0);
      assert.equal(vm.inspector ? retired.stack.length : vm.stack.length, 0, 'Stop retired the caller before the constructor returned');
      assert.deepEqual(writes, []);
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.heap.allocationObserver = previous; vm.onWrite = null; vm.stop(); }
  });
}
