import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ManagedHeap
} from '@sharpforge/runtime';
import {
  ManagedFault
} from '../packages/runtime/src/heap.js';
import {
  createException,
  exceptionField,
  exceptionFields,
  setExceptionHResult,
  prepareException,
  exceptionStackTrace,
  faultFromException,
  baseException
} from '../packages/runtime/src/execution/exception-object.js';
import {
  captureExceptionDispatch,
  throwExceptionDispatch
} from '../packages/runtime/src/execution/exception-dispatch.js';
import {
  exceptionDataCall
} from '../packages/runtime/src/execution/exception-data.js';
import {
  initializeAggregate,
  aggregateInnerList,
  flattenAggregate
} from '../packages/runtime/src/execution/aggregate-exception.js';

function services() {
  const heap = new ManagedHeap();
  return {
    heap,
    options: {},
    frames: [],
    value: reference => reference === null ? null : heap.get(reference).data
  };
}
const frame = (name, id) => ({
  id,
  method: {
    owner: 'Program',
    name,
    token: 0x06000000 + id
  },
  lastOffset: id
});

function raised(vm, name = 'DivideByZeroException') {
  const fault = new ManagedFault(name, 'failure');
  vm.frames = [frame('Main', 1), frame('Origin', 2)];
  return prepareException(vm, fault);
}

test('T04.5 exception fields have named inherited layouts and preserve managed inner identity', () => {
  const vm = services();
  const inner = createException(vm, 'System.Exception', vm.heap.string('inner'));
  const outer = createException(vm, 'System.InvalidOperationException', vm.heap.string('outer'), inner);
  assert.deepEqual(vm.heap.get(outer).methodTable.fields.map(field => field.name), exceptionFields.map(field => field.name));
  assert.equal(vm.value(exceptionField(vm, outer, 'Message')), 'outer');
  assert.equal(exceptionField(vm, outer, 'InnerException'), inner);
  assert.equal(baseException(vm, outer), inner);
  assert.equal(exceptionField(vm, outer, 'HResult'), 0x80131509 | 0);
  assert.equal(exceptionStackTrace(vm, outer), null);
  setExceptionHResult(vm, outer, 42);
  assert.equal(exceptionField(vm, outer, 'HResult'), 42);
});

test('T04.5 rethrow preserves frames and throw ex resets them', () => {
  const vm = services();
  const original = raised(vm);
  const originalTrace = exceptionStackTrace(vm, original.reference);
  assert.equal(originalTrace, '   at Program.Origin()\n   at Program.Main()');
  vm.frames = [frame('Catch', 3)];
  prepareException(vm, original);
  assert.equal(exceptionStackTrace(vm, original.reference), originalTrace);
  const again = faultFromException(vm, original.reference);
  prepareException(vm, again);
  assert.equal(exceptionStackTrace(vm, again.reference), '   at Program.Catch()');
});

test('T04.5 EDI captures a trace independently of later throws of the same exception', () => {
  const vm = services();
  const fault = raised(vm);
  const dispatch = captureExceptionDispatch(vm, fault.reference);
  vm.frames = [frame('Reset', 3)];
  prepareException(vm, faultFromException(vm, fault.reference));
  vm.frames = [frame('Dispatch', 4)];
  let resumed;
  try {
    throwExceptionDispatch(vm, dispatch);
  } catch (error) {
    resumed = error;
  }
  assert.equal(resumed.reference, fault.reference);
  prepareException(vm, resumed);
  assert.match(exceptionStackTrace(vm, fault.reference), /Program\.Origin[\s\S]*previous location[\s\S]*Program\.Dispatch/);
  assert.doesNotMatch(exceptionStackTrace(vm, fault.reference), /Program\.Reset/);
  assert.throws(() => captureExceptionDispatch(vm, null), {
    name: 'ArgumentNullException'
  });
});

test('T04.5 Data identity, contents and inner exception chains are traced by the heap', () => {
  const vm = services();
  const inner = createException(vm, 'Exception');
  const outer = createException(vm, 'Exception', null, inner);
  const dictionary = exceptionField(vm, outer, 'Data');
  const key = vm.heap.string('payload');
  const value = vm.heap.string('retained');
  exceptionDataCall(vm, dictionary, 'set_Item', [key, value]);
  vm.heap.rootProvider = () => [outer];
  vm.heap.collect();
  assert.equal(exceptionField(vm, outer, 'Data'), dictionary);
  assert.equal(exceptionField(vm, outer, 'InnerException'), inner);
  assert.equal(vm.value(exceptionDataCall(vm, dictionary, 'get_Item', [vm.heap.string('payload')])), 'retained');
  assert.equal(exceptionDataCall(vm, dictionary, 'get_Count', []), 1);
  assert.throws(() => exceptionDataCall(vm, dictionary, 'Add', [key, value]), {
    name: 'ArgumentException'
  });
  assert.throws(() => exceptionDataCall(vm, dictionary, 'set_Item', [null, value]), {
    name: 'ArgumentNullException'
  });
});

test('T04.5 flattened aggregates retain breadth-first leaf ordering and independent lists', () => {
  const vm = services();
  const leaves = ['a', 'b', 'c'].map(text => createException(vm, 'Exception', vm.heap.string(text)));
  const make = items => {
    const array = vm.heap.allocate('array', 'System.Exception[]', items);
    const aggregate = createException(vm, 'System.AggregateException');
    return initializeAggregate(vm, aggregate, [array], {
      parameters: ['System.Exception[]']
    });
  };
  const nested = make(leaves.slice(0, 2));
  const original = make([nested, leaves[2]]);
  const flattened = flattenAggregate(vm, original);
  assert.deepEqual(vm.heap.get(aggregateInnerList(vm, flattened)).data, [leaves[2], leaves[0], leaves[1]]);
  assert.deepEqual(vm.heap.get(aggregateInnerList(vm, original)).data, [nested, leaves[2]]);
});

test('T04.5 exception state is isolated by COW heap snapshots', () => {
  const vm = services();
  const fault = raised(vm);
  const snapshot = vm.heap.snapshot();
  setExceptionHResult(vm, fault.reference, 42);
  vm.frames = [frame('Changed', 4)];
  prepareException(vm, faultFromException(vm, fault.reference));
  vm.heap.restore(snapshot);
  assert.equal(exceptionField(vm, fault.reference, 'HResult'), 0x80020012 | 0);
  assert.match(exceptionStackTrace(vm, fault.reference), /Program\.Origin/);
});
