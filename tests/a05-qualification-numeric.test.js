import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {numericDifferential, int32Operations, int64Operations} from '../bench/vm/numeric-differential.js';
import {arithmeticAssembly} from '../bench/vm/qualification-assembly.js';

const options = {int32Cases: 4096, int64Cases: 4096, nativeBits: 32, seed: 0xa0507, timeoutSeconds: 60};

test('public preparation records immutable verified numeric selection counts without guest execution', () => {
  const vm = new CilVirtualMachine(arithmeticAssembly('add', 32), {arguments: [1, 2], specializeNumericHandlers: true});
  try {
    const report = prepareExecution(vm);
    assert(Object.isFrozen(report.numericHandlerCounts));
    assert.equal(report.numericHandlerCounts.add_i4, 1);
    assert.equal(vm.instructions, 0);
    assert.equal(vm.top.pc, 0);
    assert.equal(vm.run().returnValue, 3);
  } finally { vm.stop(); }
});

for (const width of [32, 64]) {
  test(`${width}-bit qualification executes every real selected handler and marks reduced counts partial`, async () => {
    const report = await numericDifferential(width, options);
    assert.equal(report.status, 'partial', JSON.stringify(report.error));
    assert.equal(report.completed, 4096);
    assert.equal(report.operations.length, width === 32 ? int32Operations.length : int64Operations.length);
    assert(report.operations.every(row => row.completed === row.requested && row.handler));
    assert(report.operations.reduce((sum, row) => sum + row.faults, 0) > 0);
    assert.equal(report.nativeQualification, false);
    assert.equal(report.meetsAcceptanceCount, false);
    if (width === 64) {
      assert(report.operations.every(row => row.safeInt64Operands > 0 && row.wideInt64Operands > 0));
    }
  });
}

test('differential cancellation records incomplete execution without an acceptance claim', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancel qualification'));
  const report = await numericDifferential(32, options, controller.signal);
  assert.equal(report.status, 'cancelled');
  assert.equal(report.completed, 0);
  assert.equal(report.meetsAcceptanceCount, false);
  assert.match(report.error.message, /cancel qualification/);
});

test('differential rejects unbounded counts, invalid ABI, seed and time limits before execution', async () => {
  for (const edit of [{int32Cases: 0}, {int32Cases: 10000001}, {nativeBits: 16}, {seed: -1}, {timeoutSeconds: Infinity}]) {
    await assert.rejects(numericDifferential(32, {...options, ...edit}), RangeError);
  }
});
