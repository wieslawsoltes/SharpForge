import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {wasmEligibility} from '../packages/runtime/src/execution/wasm/eligibility.js';
import {interpretWasmInstruction} from '../packages/runtime/src/execution/wasm/interpret-ir.js';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {managedFixture} from './managed-fixtures.js';

function inspect(method, options) {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int', ...method}]}));
  return wasmEligibility(vm, vm.top.method, options);
}

test('T11.1 verified arithmetic lowers to immutable typed stack IR', () => {
  const report = inspect({body: writer => writer.op('ldc.i4.2').op('ldc.i4.3').op('mul').op('ret')});
  assert.equal(report.eligible, true, JSON.stringify(report.reasons));
  assert.equal(report.ir.nativeInstructions, 3);
  assert.deepEqual(report.ir.instructions[2].inputs, ['i32', 'i32']);
  assert.equal(report.ir.instructions[2].depth, 2);
  assert.equal(report.ir.instructions[2].kind, 'binary');
  assert.equal(Object.isFrozen(report.ir.instructions[2]), true);
});

test('T11.1 byref locals reject the entire method with a stable reason', () => {
  const report = inspect({locals: ['int'], body: writer => writer.op('ldloca.s', 0).op('pop').op('ldc.i4.1').op('ret')});
  assert.equal(report.eligible, false);
  assert.equal(report.reasons[0].code, 'WASM_OPCODE');
  assert.equal(report.reasons[0].offset, 0);
  assert.equal(report.ir, null);
});

test('T11.1 compile limits and verification proof are mandatory', () => {
  const report = inspect({body: writer => writer.op('ldc.i4.1').op('ret')}, {maxMethodInstructions: 1});
  assert.equal(report.reasons[0].code, 'WASM_SIZE');
  assert.throws(() => inspect({body: writer => writer.op('ldc.i4.1').op('ret')}, {maxMethodInstructions: Infinity}), RangeError);
  const vm = new CilVirtualMachine(managedFixture());
  vm.report = {success: false};
  assert.equal(wasmEligibility(vm, vm.top.method).reasons[0].code, 'WASM_UNVERIFIED');
});

test('T11.1 loops retain exact backward PC targets for OSR', () => {
  const report = inspect({locals: ['int'], body: writer => writer.op('ldc.i4.0').op('stloc.0')
    .mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4.8').op('blt.s', 'loop').op('ldloc.0').op('ret')});
  assert.equal(report.eligible, true, JSON.stringify(report.reasons));
  assert.deepEqual(report.ir.instructions[8].targets, [2]);
});

test('T11.1 typed IR roundtrip retains branch behavior and final evaluation values', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4.8').op('blt.s', 'loop').op('ldloc.0').op('ret')} ]});
  const reference = new CilVirtualMachine(bytes);
  const vm = new CilVirtualMachine(bytes);
  const {ir} = wasmEligibility(vm, vm.top.method);
  let budget = 1000;
  while (vm.frames.length) {
    assert.ok(budget-- > 0);
    const frame = vm.top;
    const instruction = ir.instructions[frame.pc++];
    frame.lastOffset = instruction.offset;
    interpretWasmInstruction(vm, frame, instruction, cilHandlers.get(instruction.name));
  }
  assert.equal(vm.returnValue, reference.run().returnValue);
});
