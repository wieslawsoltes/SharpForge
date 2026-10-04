import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  verifyCilAssembly
} from '@sharpforge/cil';
import {
  controlFixture
} from './support/control-fixture.js';

function counting(depth) {
  return controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        result: 'int',
        body: (writer, context) => writer.op('ldc.i4', depth).op('ldc.i4.0')
          .op('call', context.methods.get('Program.Count')).op('ret')
      },
      {
        name: 'Count',
        result: 'int',
        parameters: ['int', 'int'],
        body(writer, context) {
          writer.op('ldarg.0').op('brfalse', 'done').op('ldarg.0').op('ldc.i4.1').op('sub');
          writer.op('ldarg.1').op('ldc.i4.1').op('add').op('tail.').op('call', context.methods.get('Program.Count'));
          writer.op('ret').label('done').op('ldarg.1').op('ret');
        }
      }
    ]
  }]);
}

test('T02.7 one million tail calls use at most two live frames', () => {
  const vm = new CilVirtualMachine(counting(1000000), {
    maxFrames: 2
  });
  let maximum = 0;
  while (vm.state === 'ready' || vm.state === 'running') {
    vm.runSlice({
      instructionBudget: 10000,
      timeBudgetMs: 1000
    });
    maximum = Math.max(maximum, vm.frames.length);
  }
  assert.equal(vm.state, 'terminated', vm.fault?.message);
  assert.equal(vm.returnValue, 1000000);
  assert(maximum <= 2);
  assert.equal(vm.frames.length, 0);
});

test('T02.7 a caller-local reference causes ordinary-call fallback with the same result', () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        result: 'int',
        body: (writer, context) => writer.op('call', context.methods.get('Program.Owner')).op('ret')
      },
      {
        name: 'Owner',
        result: 'int',
        locals: ['int'],
        body(writer, context) {
          writer.op('ldc.i4', 42).op('stloc.0').op('ldloca.s', 0).op('tail.').op('call', context.methods.get('Program.Read')).op('ret');
        }
      },
      {
        name: 'Read',
        parameters: ['int'],
        signature: Uint8Array.from([0, 1, 8, 0x10, 8]),
        body: writer => writer.op('ldarg.0').op('ldind.i4').op('ret')
      }
    ]
  }]);
  const vm = new CilVirtualMachine(bytes);
  let maximum = 0;
  while (vm.state === 'ready' || vm.state === 'running') {
    vm.runSlice({
      instructionBudget: 1,
      timeBudgetMs: 1000
    });
    maximum = Math.max(maximum, vm.frames.length);
  }
  assert.equal(vm.returnValue, 42, vm.fault?.message);
  assert.equal(maximum, 3);
});

test('T02.7 jmp transfers current arguments without adding a frame', () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        result: 'int',
        body: (writer, context) => writer.op('ldc.i4', 41)
          .op('call', context.methods.get('Program.Forward')).op('ret')
      },
      {
        name: 'Forward',
        result: 'int',
        parameters: ['int'],
        body: (writer, context) => writer.op('jmp', context.methods.get('Program.Target'))
      },
      {
        name: 'Target',
        result: 'int',
        parameters: ['int'],
        body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')
      }
    ]
  }]);
  const result = new CilVirtualMachine(bytes, {
    maxFrames: 2
  }).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
});

test('T02.7 jmp mismatched signatures and residual stack values fail verification', () => {
  for (const mismatch of [true, false]) {
    const bytes = controlFixture([{
      name: 'Program',
      methods: [{
          name: 'Main',
          result: 'int',
          body(writer, context) {
            if (!mismatch) writer.op('ldc.i4.1');
            writer.op('jmp', context.methods.get('Program.Target'));
          }
        },
        {
          name: 'Target',
          result: mismatch ? 'void' : 'int',
          body(writer) {
            if (!mismatch) writer.op('ldc.i4.1');
            writer.op('ret');
          }
        }
      ]
    }]);
    assert.equal(verifyCilAssembly(bytes).success, false);
  }
});

test('T02.7 a tail callee exceeding the byte budget preserves its caller atomically', () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        maxStack: 1,
        body: (writer, context) => writer.op('tail.').op('call', context.methods.get('Program.Large')).op('ret')
      },
      {
        name: 'Large',
        locals: Array(100).fill('int'),
        body: writer => writer.op('ret')
      }
    ]
  }]);
  const vm = new CilVirtualMachine(bytes, {
    maxStackBytes: 128
  });
  const original = vm.top;
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'StackOverflowException');
  assert.equal(vm.top, original);
  assert.equal(vm.frames.length, 1);
});
