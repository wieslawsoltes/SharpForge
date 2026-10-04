import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, framePoolStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {reserveStackFrame, cancelStackFrame, releaseStackFrame, releaseStackReservation}
  from '../packages/runtime/src/execution/stack-budget.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool, framePool} from '../packages/runtime/src/execution/frame-pool.js';
import {enterPreparedCilFrame, preparedCilTarget} from '../packages/runtime/src/execution/prepared-cil-frame.js';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';

const compiled = compileToIL('class Program { static int Main() { return 42; } }');
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const overflow = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};

function setup(engine) {
  const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly)
    : new VirtualMachine(engine === 'source' ? compiled.image : compiled.assembly);
  const method = vm.inspector ? vm.top.method : vm.image.methods[vm.top.methodId];
  const entry = vm.inspector ? method.token : method.id;
  const ticket = reserveStackFrame(vm, method, 0), charge = ticket.bytes;
  cancelStackFrame(ticket);
  releaseStackReservation(ticket);
  vm.options.maxStackBytes = charge * 2;
  return {vm, entry, charge, method};
}

for (const engine of ['source', 'reloaded', 'cil']) {
  test(`${engine}: retiring and reusing one frame keeps exact quota charges and idempotent release`, () => {
    const {vm, entry} = setup(engine);
    try {
      let reused;
      for (let iteration = 0; iteration < 8; iteration++) {
        vm.call(entry, []);
        const frame = vm.top;
        if (reused) assert.equal(frame, reused);
        const allocated = framePoolStatistics(vm).framesAllocated;
        assert.throws(() => vm.call(entry, []), overflow);
        assert.equal(framePoolStatistics(vm).framesAllocated, allocated, 'Reject before pool allocation');
        assert.equal(popPooledFrame(vm), frame);
        releaseStackFrame(vm, frame);
        releaseStackFrame(vm, frame);
        flushFramePool(vm);
        reused = frame;
      }
      assert.equal(vm.frames.length, 1);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      // Synchronous source run() exposes exitCode; its managed result remains on the VM.
      assert.equal(vm.inspector ? result.returnValue : vm.value(vm.returnValue), 42);
      assert.equal(result.exitCode, 42);
    } finally { vm.stop(); }
  });

  test(`${engine}: restore and epoch changes rebuild live charges after prior frame reuse`, () => {
    const {vm, entry} = setup(engine);
    try {
      vm.call(entry, []);
      popPooledFrame(vm);
      flushFramePool(vm);
      const saved = vm.snapshot();
      vm.call(entry, []);
      vm.restore(saved);
      assert.equal(vm.frames.length, 1);
      invalidateExecutionCode(vm, 'reservation-reuse-regression');
      vm.call(entry, []);
      assert.throws(() => vm.call(entry, []), overflow);
      popPooledFrame(vm);
      flushFramePool(vm);
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
    } finally { vm.stop(); }
  });

  test(`${engine}: a failed reentrant allocator releases only its own provisional reservation`, () => {
    const {vm, entry, charge} = setup(engine), pool = framePool(vm), acquire = pool.acquire;
    const failure = new Error('outer allocation failed');
    let nested = false;
    try {
      vm.options.maxStackBytes = 3 * charge;
      pool.acquire = function(...args) {
        if (!nested) {
          nested = true;
          vm.call(entry, []);
          throw failure;
        }
        return acquire.apply(this, args);
      };
      assert.throws(() => vm.call(entry, []), error => error === failure);
      assert.equal(vm.frames.length, 2);
      pool.acquire = acquire;
      vm.call(entry, []);
      assert.equal(vm.frames.length, 3);
      const allocated = framePoolStatistics(vm).framesAllocated;
      assert.throws(() => vm.call(entry, []), overflow);
      assert.equal(framePoolStatistics(vm).framesAllocated, allocated);
    } finally { pool.acquire = acquire; vm.stop(); }
  });
}

test('reservation scopes reuse inactive tickets with a bounded retained pool', () => {
  const {vm, charge, method} = setup('cil');
  const active = [];
  try {
    vm.options.maxStackBytes = charge * 66;
    const first = reserveStackFrame(vm, method, 0);
    const second = reserveStackFrame(vm, method, 0);
    assert.notEqual(first, second, 'Active scopes never share a ticket');
    releaseStackReservation(first);
    assert.equal(second.active, true);
    const reused = reserveStackFrame(vm, method, 0);
    assert.equal(reused, first);
    releaseStackReservation(reused);
    releaseStackReservation(second);
    for (let index = 0; index < 64; index++) active.push(reserveStackFrame(vm, method, 0));
    const previous = new Set(active);
    for (const ticket of active) releaseStackReservation(ticket);
    active.length = 0;
    for (let index = 0; index < 64; index++) active.push(reserveStackFrame(vm, method, 0));
    assert.equal(active.filter(ticket => previous.has(ticket)).length, 32, 'Do not retain unbounded reentrant depth');
  } finally { for (const ticket of active) releaseStackReservation(ticket); vm.stop(); }
});

for (const transition of ['epoch', 'quota-disabled', 'restore', 'stop']) {
  test(`an outstanding ticket cannot alter the replacement budget after ${transition}`, () => {
    const {vm, method, charge, entry} = setup('cil'), saved = vm.snapshot();
    const old = reserveStackFrame(vm, method, 0);
    let current;
    try {
      if (transition === 'epoch') invalidateExecutionCode(vm, 'active-reservation-regression');
      if (transition === 'quota-disabled') {
        delete vm.options.maxStackBytes;
        assert.equal(reserveStackFrame(vm, method, 0), null);
        vm.options.maxStackBytes = 2 * charge;
      }
      if (transition === 'restore') vm.restore(saved);
      if (transition === 'stop') { vm.stop(); vm.call(entry, []); }
      current = reserveStackFrame(vm, method, 0);
      assert.notEqual(old, current);
      releaseStackReservation(old);
      assert.throws(() => reserveStackFrame(vm, method, 0), overflow);
      releaseStackReservation(current);
      current = reserveStackFrame(vm, method, 0);
      assert.equal(current.active, true);
    } finally { releaseStackReservation(old); releaseStackReservation(current); vm.stop(); }
  });
}

for (const engine of ['source', 'reloaded']) {
  test(`${engine}: a failed root-pin setup also closes its reservation scope`, () => {
    const {vm, entry} = setup(engine), push = vm.heap.pins.push;
    const failure = new Error('pin setup failed');
    try {
      vm.heap.pins.push = () => { throw failure; };
      assert.throws(() => vm.call(entry, []), error => error === failure);
      assert.equal(vm.frames.length, 1);
      vm.heap.pins.push = push;
      vm.call(entry, []);
      assert.equal(vm.frames.length, 2);
      assert.throws(() => vm.call(entry, []), overflow);
    } finally { vm.heap.pins.push = push; vm.stop(); }
  });
}

test('a post-commit registration failure cannot cancel a reentrant reservation', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture()), caller = vm.top;
  const token = vm.inspector.types.find(type => type.name === 'Receiver0').methods.find(method => method.name === 'Value').token;
  const prepared = preparedCilTarget(vm, token, {}), push = vm.frames.push;
  let nested, probe;
  try {
    const sizing = reserveStackFrame(vm, prepared.method, 1);
    const charge = sizing.bytes, total = sizing.budget.total - charge;
    releaseStackReservation(sizing);
    vm.options.maxStackBytes = total + 2 * charge;
    caller.stack.push(vm.heap.object('Receiver0', []));
    vm.frames.push = function(frame) {
      nested = reserveStackFrame(vm, prepared.method, 1);
      frame.id = caller.id;
      return push.call(this, frame);
    };
    assert.throws(() => enterPreparedCilFrame(vm, prepared, caller.stack, 0, 1, {}), /Duplicate live frame/);
    assert.equal(vm.top, caller);
    assert.equal(nested.active, true);
    probe = reserveStackFrame(vm, prepared.method, 1);
    assert.throws(() => reserveStackFrame(vm, prepared.method, 1), overflow);
  } finally {
    vm.frames.push = push;
    releaseStackReservation(nested);
    releaseStackReservation(probe);
    vm.stop();
  }
});
