import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, ConstrainedObjectProfile, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const minimum = -(1n << 63n), maximum = (1n << 63n) - 1n;
const names = {long: 'System.Int64', ulong: 'System.UInt64'};
const display = (type, value) => String(type === 'ulong' ? BigInt.asUintN(64, value) : value);

function fixture({type = 'long', value = -1n, kind = 'local', initialized = true, generic = false} = {}) {
  return genericCallFixture([
    {name: 'Cell', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Value', type}], methods: []},
    {name: 'Program', fields: [{name: 'Value', type, flags: 0x16}], methods: [
      {name: 'Read', parameters: [type], result: 'string', body(writer, context) {
        writer.op('ldarga.s', 0).op('constrained.', context.resolve(names[type]))
          .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
      }},
      {name: 'Apply', parameters: ['!!0&'], result: 'string', genericParameters: [{flags: 24}], body(writer, context) {
        writer.op('ldarg.0').op('constrained.', context.typeSpec('!!0'))
          .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
      }},
      {name: 'Main', result: 'string', locals: [type, type === 'long' ? 'ulong' : 'long', 'valuetype Cell'],
        initLocals: initialized, body(writer, context) {
        context.resolve('System.Int32'); // Also exercise the preserved metadata predicate against the same descriptor.
        const token = context.resolve(names[type]), raw = BigInt.asIntN(64, value);
        if (kind === 'argument') {
          writer.op('ldc.i8', raw).op('call', context.methods.get('Program.Read')).op('ret'); return;
        }
        if (kind === 'array') {
          writer.op('ldc.i4.1').op('newarr', token).op('dup').op('ldc.i4.0').op('ldc.i8', raw).op('stelem.i8')
            .op('ldc.i4.0').op('ldelema', token);
        } else if (kind === 'box') {
          writer.op('ldc.i8', raw).op('box', token).op('unbox', token);
        } else if (kind === 'field') {
          writer.op('ldloca.s', 2).op('dup').op('ldc.i8', raw).op('stfld', context.fields.get('Cell.Value'))
            .op('ldflda', context.fields.get('Cell.Value'));
        } else if (kind === 'static') {
          writer.op('ldc.i8', raw).op('stsfld', context.fields.get('Program.Value')).op('ldsflda', context.fields.get('Program.Value'));
        } else {
          if (initialized) writer.op('ldc.i8', raw).op('stloc.0');
          writer.op('ldloca.s', 0);
        }
        if (generic) writer.op('call', context.methodSpec(context.methods.get('Program.Apply'), [type]));
        else writer.op('constrained.', token).op('callvirt', context.member('System.Object', 'ToString', 'string', [], false));
        writer.op('ret');
      }}
    ]}
  ]);
}

function withVM(bytes, callback, options = {}, VM = CilVirtualMachine) {
  const vm = new VM(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pause(vm, opcode = 'callvirt') {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction: instruction => instruction.name === opcode});
  assert.equal(vm.state, 'paused');
}

for (const type of ['long', 'ulong']) for (const nativeIntBits of [32, 64]) {
  test(`${type} decimal text preserves all 64 bits at ABI${nativeIntBits} without boxing`, () => {
    for (const value of [minimum, -1n, 0n, 9007199254740993n, maximum]) {
      withVM(fixture({type, value}), vm => {
        const before = vm.heap.stats.allocations;
        assert.equal(vm.run().state, 'terminated');
        assert.equal(vm.format(vm.returnValue), display(type, value));
        assert.equal(vm.heap.stats.allocations - before, 1);
        assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
      }, {nativeIntBits});
    }
  });
}

for (const type of ['long', 'ulong']) for (const kind of ['local', 'argument', 'array', 'box', 'field', 'static']) {
  test(`${type} ${kind} storage keeps the signed stack bits and exact declared type`, () => {
    withVM(fixture({type, kind, value: minimum}), vm => {
      pause(vm);
      const address = vm.top.stack[0], before = vm.heap.stats.allocations;
      assert.equal(vm.dereference(address), minimum);
      vm.step();
      assert.equal(vm.dereference(address), minimum);
      assert.equal(vm.format(vm.top.stack[0]), display(type, minimum));
      assert.equal(vm.heap.stats.allocations - before, 1, 'existing box interior needs no additional box');
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
    }, {decodePlans: false});
  });
}

for (const type of ['long', 'ulong']) test(`${type} canonical BigInt payloads reject Number and out-of-range host values`, () => {
  withVM(fixture({type}), vm => {
    pause(vm);
    const snapshot = vm.snapshot();
    for (const value of [undefined, null, 1, 9007199254740992, minimum - 1n, maximum + 1n,
      Object.freeze({nativeInt: 64, value: 1n}), Object.freeze({h: 0, g: 1, value: 1n})]) {
      vm.restore(snapshot);
      vm.top.locals[0] = value;
      const stack = [...vm.top.stack], before = vm.heap.stats.allocations;
      assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, stack);
      assert.equal(vm.heap.stats.allocations, before);
    }
  });
});

for (const type of ['long', 'ulong']) test(`${type} rejects opposite signedness, foreign, readonly and by-value receivers`, () => {
  const bytes = fixture({type});
  withVM(bytes, vm => withVM(bytes, foreign => {
    pause(vm);
    const snapshot = vm.snapshot(), original = vm.top.stack[0];
    const cases = [[vm.address('local', 1), 'InvalidProgramException'],
      [foreign.address('local', 0), 'InvalidProgramException'], [0n, 'InvalidProgramException'],
      [Object.freeze({...original, readonly: true}), 'NotSupportedException']];
    for (const [receiver, name] of cases) {
      vm.restore(snapshot);
      vm.top.stack[0] = receiver;
      const stack = [...vm.top.stack];
      assert.throws(() => vm.step(), {name});
      assert.deepEqual(vm.top.stack, stack);
    }
  }));
});

for (const type of ['long', 'ulong']) for (const opcode of ['constrained.', 'callvirt', 'ret']) {
  test(`${type} snapshot at ${opcode} preserves formatting and stop invalidates the address`, () => {
    withVM(fixture({type, value: minimum}), vm => {
      pause(vm, opcode);
      const snapshot = vm.snapshot(), address = vm.address('local', 0);
      for (let replay = 0; replay < 2; replay++) {
        vm.restore(snapshot);
        invalidateExecutionCode(vm, 'int64-tostring-replay');
        vm.heap.collect();
        vm.state = 'running';
        assert.equal(vm.run().state, 'terminated');
        assert.equal(vm.format(vm.returnValue), display(type, minimum));
        assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
      }
      vm.restore(snapshot);
      vm.stop();
      assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
    });
  });
}

for (const type of ['long', 'ulong']) test(`${type} temporary array stays rooted during the unchanged formatter`, () => {
  class CollectingVM extends CilVirtualMachine {
    format(value, format) {
      if (format === type) {
        const address = this.top.stack[0];
        this.top.stack[0] = null;
        try { this.heap.collect(); assert.equal(this.heap.get(address.owner).kind, 'array'); }
        finally { this.top.stack[0] = address; }
      }
      return super.format(value, format);
    }
  }
  withVM(fixture({type, kind: 'array'}), vm => {
    vm.heap.threshold = 0;
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), display(type, -1n));
    assert(vm.heap.stats.collections >= 2);
  }, {}, CollectingVM);
});

for (const type of ['long', 'ulong']) test(`${type} allocation failure preserves its original address and roots`, () => {
  withVM(fixture({type}), vm => {
    pause(vm);
    vm.heap.maxBytes = 1;
    const address = vm.top.stack[0], pins = vm.heap.pins.length;
    assert.throws(() => vm.step(), {name: 'OutOfMemoryException'});
    assert.equal(vm.top.stack[0], address);
    assert.equal(vm.dereference(address), -1n);
    assert.equal(vm.heap.pins.length, pins);
  });
});

for (const type of ['long', 'ulong']) test(`${type} initlocals=false remains uninitialized`, () => {
  withVM(fixture({type, initialized: false}), vm => assert.equal(vm.run().fault?.name, 'InvalidProgramException'));
});

for (const type of ['long', 'ulong']) test(`${type} generic parameter constraint remains outside this concrete leaf`, () => {
  const report = verifyCilAssembly(fixture({type, generic: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.method === 'Program::Apply' && issue.code === 'IL_PREFIX'));
});

test('metadata plans stay frozen and cached while the int32 boolean helper retains its contract', () => {
  for (const type of ['long', 'ulong']) {
    const inspector = new AssemblyInspector(fixture({type})), profile = new ConstrainedObjectProfile(inspector);
    const instructions = inspector.getMethod(inspector.pe.entryPoint).instructions;
    const token = instructions.find(instruction => instruction.name === 'constrained.').operand;
    const descriptor = inspector.resolveToken(instructions.find(instruction => instruction.name === 'callvirt').operand);
    const index = inspector.metadata.rows[1].findIndex((_, index) => inspector.metadata.typeName(0x01000001 + index) === 'System.Int32');
    const int32 = 0x01000001 + index;
    const plan = profile.primitive(token, descriptor);
    assert.deepEqual(plan, {name: names[type], format: type});
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(profile.primitive(token, descriptor), plan);
    assert.equal(profile.int32(int32, descriptor), true);
    assert.equal(profile.int32(token, descriptor), false);
    assert.equal(profile.int32(token, {}), false, 'unsupported Int32 query does not inspect another primitive declaration');
  }
});
