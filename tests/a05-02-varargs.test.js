import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  Writer,
  codedIndex,
  signatureType,
  verifyCilAssembly
} from '@sharpforge/cil';
import {
  controlFixture
} from './support/control-fixture.js';
import {
  argumentHandle,
  typedReference,
  typedReferenceValue,
  varargsCall
} from '../packages/runtime/src/execution/varargs.js';
import {
  validateVarargsSnapshot
} from '../packages/runtime/src/execution/varargs-snapshot-validation.js';

function fixture({
  badSentinel = false
} = {}) {
  return controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        result: 'int',
        body(writer, context) {
          const call = context.md.member(context.methods.get('Program.Sum'), 'Sum',
            Uint8Array.from([5, 3, 8, ...(badSentinel ? [8, 0x41, 8, 8] : [0x41, 8, 8, 8])]));
          writer.op('ldc.i4.4').op('ldc.i4.5').op('ldc.i4.6').op('call', call).op('ret');
        }
      },
      {
        name: 'Sum',
        result: 'int',
        signature: Uint8Array.from([5, 0, 8]),
        localBytes: context => new Writer().u8(7).u8(2).u8(0x11)
          .compressed(codedIndex('TypeDefOrRef', context.resolve('System.ArgIterator'))).u8(8).finish(),
        body(writer, context) {
          const iterator = 'System.ArgIterator';
          writer.op('ldloca.s', 0).op('arglist').op('call', context.member(iterator, '.ctor', 'void', ['System.RuntimeArgumentHandle'],
            false));
          writer.label('again').op('ldloca.s', 0).op('call', context.member(iterator, 'GetRemainingCount', 'int', [], false));
          writer.op('brfalse', 'done').op('ldloc.1').op('ldloca.s', 0);
          writer.op('call', context.member(iterator, 'GetNextArg', 'typedref', [], false));
          writer.op('refanyval', context.resolve('System.Int32')).op('ldind.i4').op('add').op('stloc.1').op('br', 'again');
          writer.label('done').op('ldloca.s', 0).op('call', context.member(iterator, 'End', 'void', [], false));
          writer.op('ldloc.1').op('ret');
        }
      }
    ]
  }]);
}

test('T02.9 managed arglist iterates optional values through typed references', () => {
  const result = new CilVirtualMachine(fixture()).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 15);
});

test('T02.9 malformed fixed/optional sentinel is rejected before execution', () => {
  const report = verifyCilAssembly(fixture({
    badSentinel: true
  }));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /Vararg fixed signature/.test(issue.message)));
});

test('T02.9 typed references reject mismatched types and expired frames', () => {
  const vm = new CilVirtualMachine(fixture());
  let budget = 100;
  while (!vm.top?.varargs?.length && budget--) vm.runSlice({
    instructionBudget: 1,
    timeBudgetMs: 1000
  });
  const frame = vm.top;
  assert.equal(frame.varargs.length, 3);
  const pointer = vm.address('arg', frame.varargs[0].index, null, {
    frameId: frame.id,
    type: 'int'
  });
  const reference = typedReference(vm, pointer, 'int');
  assert.equal(vm.dereference(typedReferenceValue(vm, reference, 'int')), 4);
  assert.throws(() => typedReferenceValue(vm, reference, 'string'), {
    name: 'InvalidCastException'
  });
  const handle = argumentHandle(vm, frame);
  vm.run();
  assert.throws(() => typedReferenceValue(vm, reference, 'int'), {
    name: 'InvalidProgramException'
  });
  const descriptor = {
    owner: 'System.ArgIterator',
    name: '.ctor',
    signature: {
      isStatic: false,
      returnType: 'void'
    }
  };
  assert.throws(() => varargsCall(vm, descriptor, [handle], 'newobj'), {
    name: 'InvalidProgramException'
  });
});

test('T02.9 snapshot preflight rejects packet corruption without using live frames', () => {
  const vm = new CilVirtualMachine(fixture());
  let budget = 100;
  while (!vm.top?.varargs?.length && budget--) vm.runSlice({
    instructionBudget: 1,
    timeBudgetMs: 1000
  });
  const snapshot = vm.snapshot();
  validateVarargsSnapshot(vm, snapshot);
  snapshot.frames.at(-1).varargs[0].index++;
  assert.throws(() => validateVarargsSnapshot(vm, snapshot), /varargs snapshot/);
});


test('T02.9 metadata writer preserves typed-reference element and argument value types', () => {
  for (const type of ['typedref', 'System.TypedReference']) {
    assert.deepEqual([...signatureType(new Writer(), type, () => 0x01000001).finish()], [0x16]);
  }
  for (const type of ['System.ArgIterator', 'System.RuntimeArgumentHandle']) {
    assert.deepEqual([...signatureType(new Writer(), type, () => 0x01000001).finish()], [0x11, 5]);
  }
});
