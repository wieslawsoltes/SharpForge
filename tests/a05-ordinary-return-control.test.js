import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {continueControlReturn} from '../packages/runtime/src/execution/return-control.js';

let program;
function make(cil = false) {
  program ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return cil ? new CilVirtualMachine(program.assembly) : new VirtualMachine(program.image);
}

function objectState(vm, capture = false) {
  return {owner: vm.snapshotOwner, ownerFrameId: vm.top.id, operation: 'GetHashCode', capture,
    remaining: 1, result: null,
    nodes: [{left: null, right: null, type: null, defaultOnly: false, phase: 'waiting', index: 0, hash: 0}]};
}

function eventState() {
  return {phase: 'firstChance', fault: new ManagedFault('Exception', 'return continuation'), handlers: [], args: [], index: 0};
}

test('ordinary return preserves null, undefined, scalar and reference values without continuation delivery', () => {
  const vm = make();
  try {
    const reference = vm.heap.string('returned');
    for (const value of [null, undefined, false, 0, -0, NaN, 42, 9n, reference]) {
      const control = continueControlReturn(vm, {}, value);
      assert.equal(control, null);
      assert(Object.is(control ? control.value : value, value));
    }
    vm.heap.withRoots([reference], () => vm.heap.collect());
    assert.equal(vm.value(reference), 'returned');
  } finally { vm.stop(); }
});

for (const cil of [false, true]) {
  test(`${cil ? 'CIL' : 'source'} return reads each continuation once, in order, independently and in combination`, () => {
    const vm = make(cil), propagated = [];
    vm[cil ? 'raise' : 'handleFault'] = fault => propagated.push(fault);
    try {
      for (let mask = 1; mask < 8; mask++) {
        const reads = [], frame = {}, event = eventState();
        const states = [mask & 1 ? objectState(vm) : null, mask & 2 ? {next: 0, entries: []} : null, mask & 4 ? event : null];
        for (const [index, key] of ['objectValueContinuation', 'delegateContinuation', 'exceptionEventContinuation'].entries()) {
          Object.defineProperty(frame, key, {get() { reads.push(key); return states[index]; }});
        }
        const before = propagated.length, result = continueControlReturn(vm, frame, 37);
        assert.deepEqual(reads, ['objectValueContinuation', 'delegateContinuation', 'exceptionEventContinuation']);
        assert.equal(propagated.length, before + Number(!!(mask & 4)));
        if (mask & 4) {
          assert.equal(result.handled, true);
          assert.equal(propagated.at(-1), event.fault);
          assert.equal(event.fault.exceptionEventResume, 'firstChance');
        } else assert.equal(result ? result.value : 37, 37);
      }
      const frame = {objectValueContinuation: objectState(vm, true)};
      Object.defineProperty(frame, 'delegateContinuation', {get() { assert.fail('captured result must not advance delegates'); }});
      assert.equal(continueControlReturn(vm, frame, 19).handled, true);
      assert.equal(vm.top.objectValueResult, 19);
      const equals = objectState(vm);
      equals.operation = 'Equals';
      const transformed = continueControlReturn(vm, {objectValueContinuation: equals}, 7);
      assert.equal(transformed.handled, false);
      assert.equal(transformed.value, cil ? 1 : true);
    } finally { vm.stop(); }
  });
}

test('Object string validation precedes absence checks and sees continuation state installed during validation', () => {
  const vm = make(), reads = [], invalid = {objectStringReturn: true};
  Object.defineProperty(invalid, 'objectValueContinuation', {get() { reads.push('continuation'); }});
  try {
    assert.throws(() => continueControlReturn(vm, invalid, 17),
      {name: 'InvalidProgramException', message: 'Object.ToString override did not return a managed string or null'});
    assert.deepEqual(reads, []);
    const value = vm.heap.string('valid'), frame = {objectStringReturn: true}, event = eventState();
    const get = vm.heap.get;
    vm.heap.get = function (reference) {
      const record = get.call(this, reference);
      frame.exceptionEventContinuation = event;
      return record;
    };
    vm.handleFault = fault => reads.push(fault);
    try { assert.equal(continueControlReturn(vm, frame, value).handled, true); }
    finally { vm.heap.get = get; }
    assert.deepEqual(reads, [event.fault]);
    assert.equal(continueControlReturn(vm, {objectStringReturn: true}, null), null);
  } finally { vm.stop(); }
});

test('delegate completion can install an exception continuation before its turn', () => {
  const vm = make(), frame = {}, event = eventState(), propagated = [];
  frame.delegateContinuation = {next: 0, entries: {get length() { frame.exceptionEventContinuation = event; return 0; }}};
  vm.handleFault = fault => propagated.push(fault);
  try {
    assert.equal(continueControlReturn(vm, frame, null).handled, true);
    assert.deepEqual(propagated, [event.fault]);
  } finally { vm.stop(); }
});
