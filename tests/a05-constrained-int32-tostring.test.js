import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function toString(writer, context, {constraint = 'System.Int32', member = 'ToString', explicitThis = false} = {}) {
  const token = constraint === 'spec' ? context.typeSpec('int') : context.resolve(constraint);
  if (member === 'Equals') writer.op('ldnull');
  writer.op('constrained.', token).op('callvirt', context.member('System.Object', member,
    member === 'ToString' ? 'string' : member === 'Equals' ? 'bool' : 'int', member === 'Equals' ? ['object'] : [], false,
    {explicitThis}));
}

function fixture({kind = 'local', value = 17, initialize = true, initLocals = true, main, ...callOptions} = {}) {
  return genericCallFixture([
    {name: 'Holder', fields: [{name: 'X', type: 'int'}], methods: [{name: '.ctor', static: false, flags: 0x1886,
      body(writer, context) { writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret'); }}]},
    {name: 'Inner', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Outer', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Inner', type: 'valuetype Inner'}], methods: []},
    {name: 'Program', fields: [{name: 'X', type: 'int', flags: 0x16}], methods: [
      {name: 'Read', parameters: ['int'], result: 'string', body(writer, context) {
        writer.op('ldarga.s', 0); toString(writer, context, callOptions); writer.op('ret');
      }},
      {name: 'Expired', result: 'int&', locals: ['int'], body: writer => writer.op('ldloca.s', 0).op('ret')},
      {name: 'Main', result: 'string', locals: ['int', 'uint', 'valuetype Outer'], initLocals, body(writer, context) {
        if (main) { main(writer, context); return; }
        const type = context.resolve('System.Int32');
        if (kind === 'argument') {
          writer.op('ldc.i4', value).op('call', context.methods.get('Program.Read')).op('ret'); return;
        }
        if (kind === 'field') {
          writer.op('newobj', context.methods.get('Holder..ctor')).op('dup').op('ldc.i4', value)
            .op('stfld', context.fields.get('Holder.X')).op('ldflda', context.fields.get('Holder.X'));
        } else if (kind === 'static') {
          writer.op('ldc.i4', value).op('stsfld', context.fields.get('Program.X')).op('ldsflda', context.fields.get('Program.X'));
        } else if (kind === 'array') {
          writer.op('ldc.i4.1').op('newarr', type).op('dup').op('ldc.i4.0').op('ldc.i4', value).op('stelem.i4')
            .op('ldc.i4.0').op('ldelema', type);
        } else if (kind === 'box') {
          writer.op('ldc.i4', value).op('box', type).op('unbox', type);
        } else if (kind === 'nested') {
          writer.op('ldloca.s', 2).op('ldflda', context.fields.get('Outer.Inner')).op('dup').op('ldc.i4', value)
            .op('stfld', context.fields.get('Inner.X')).op('ldflda', context.fields.get('Inner.X'));
        } else {
          if (initialize) writer.op('ldc.i4', value).op('stloc.0');
          writer.op('ldloca.s', 0);
        }
        toString(writer, context, callOptions);
        if (callOptions.member && callOptions.member !== 'ToString') writer.op('pop').op('ldnull');
        writer.op('ret');
      }}
    ]}
  ]);
}

function withVM(bytes, callback, options = {}, VM = CilVirtualMachine) {
  const vm = new VM(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pause(vm, predicate = instruction => instruction.name === 'callvirt') {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction: predicate});
  assert.equal(vm.state, 'paused');
}

for (const decodePlans of [false, true]) for (const value of [-2147483648, -1, 0, 1, 2147483647]) {
  test(`Int32 ${value} formats without a box, decodePlans=${decodePlans}`, () => {
    withVM(fixture({value}), vm => {
      const allocated = vm.heap.stats.allocations;
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), String(value));
      assert.equal(vm.heap.stats.allocations - allocated, 1, 'only the result string is allocated');
      assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
    }, {decodePlans});
  });
}

for (const kind of ['local', 'argument', 'field', 'static', 'array', 'box', 'nested']) {
  test(`${kind} Int32 address retains its value and allocates only the string`, () => {
    withVM(fixture({kind, value: -73}), vm => {
      pause(vm);
      const address = vm.top.stack[0], allocated = vm.heap.stats.allocations;
      assert.equal(vm.dereference(address), -73);
      vm.step();
      assert.equal(vm.dereference(address), -73);
      assert.equal(vm.format(vm.top.stack[0]), '-73');
      assert.equal(vm.heap.stats.allocations - allocated, 1);
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
    });
  });
}

test('a temporary array owner is rooted during host formatting and allocation collection', () => {
  class CollectingVM extends CilVirtualMachine {
    format(value, type) {
      if (type === 'int') {
        const address = this.top.stack[0];
        this.top.stack[0] = null;
        try {
          this.heap.collect();
          assert.equal(this.heap.get(address.owner).kind, 'array');
        } finally { this.top.stack[0] = address; }
      }
      return super.format(value, type);
    }
  }
  withVM(fixture({kind: 'array'}), vm => {
    vm.heap.threshold = 0;
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), '17');
    assert(vm.heap.stats.collections >= 2);
  }, {}, CollectingVM);
});

for (const mode of ['foreign', 'wrong-type', 'readonly', 'unfrozen', 'by-value', 'missing-owner', 'bad-path', 'bad-slot']) {
  test(`${mode} receiver fails before removing the address`, () => {
    const bytes = fixture();
    withVM(bytes, vm => withVM(bytes, other => {
      pause(vm);
      const address = vm.top.stack[0];
      const receivers = {
        foreign: other.address('local', 0), 'wrong-type': vm.address('local', 1), readonly: Object.freeze({...address, readonly: true}),
        unfrozen: {...address}, 'by-value': 17, 'missing-owner': Object.freeze({...address, vmOwner: undefined}),
        'bad-path': Object.freeze({...address, path: [0]}), 'bad-slot': Object.freeze({...address, index: 999})
      };
      vm.top.stack[0] = receivers[mode];
      const stack = [...vm.top.stack], allocated = vm.heap.stats.allocations;
      assert.throws(() => vm.step(), {name: mode === 'readonly' ? 'NotSupportedException' : 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, stack);
      assert.equal(vm.heap.stats.allocations, allocated);
    }));
  });
}

for (const value of [undefined, null, true, 1n, 1.5, NaN, Infinity, -0, 2147483648, -2147483649,
  Object.freeze({float: 'r8', value: 1}), Object.freeze({h: 0, g: 1, value: 1})]) {
  test(`noncanonical stored Int32 ${String(value)} is rejected before formatting`, () => {
    withVM(fixture(), vm => {
      pause(vm);
      vm.top.locals[0] = value;
      const stack = [...vm.top.stack];
      assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, stack);
    });
  });
}

test('initlocals=false does not supply a default through the constrained call', () => {
  withVM(fixture({initialize: false, initLocals: false}), vm => {
    assert.equal(vm.run().fault?.name, 'InvalidProgramException');
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
  });
});

test('an actual returned address outlives its source frame and is rejected', () => {
  withVM(fixture({main(writer, context) {
    writer.op('call', context.methods.get('Program.Expired'));
    toString(writer, context);
    writer.op('ret');
  }}), vm => {
    pause(vm);
    const stack = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
    assert.deepEqual(vm.top.stack, stack);
  });
});

test('a collected array interior retains the heap generation fault', () => {
  withVM(fixture(), vm => {
    pause(vm);
    const owner = vm.heap.array('int', 1), address = vm.address('array', 0, owner);
    vm.heap.collect();
    vm.top.stack[0] = address;
    assert.throws(() => vm.step(), {name: 'InvalidReferenceException'});
    assert.equal(vm.top.stack[0], address);
  });
});

for (const phase of ['prefix', 'call', 'result']) test(`snapshot at ${phase} replays without a box and stop expires addresses`, () => {
  withVM(fixture(), vm => {
    pause(vm, instruction => instruction.name === (phase === 'prefix' ? 'constrained.' : phase === 'call' ? 'callvirt' : 'ret'));
    const address = phase === 'result' ? vm.address('local', 0) : vm.top.stack[0], snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      invalidateExecutionCode(vm, 'int32-tostring-replay');
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), '17');
      assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
    }
    vm.restore(snapshot);
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  });
});

test('failed string allocation preserves the address and temporary-root balance', () => {
  withVM(fixture(), vm => {
    pause(vm);
    const address = vm.top.stack[0], pins = vm.heap.pins.length;
    assert.throws(() => vm.step(), {name: 'OutOfMemoryException'});
    assert.equal(vm.top.stack[0], address);
    assert.equal(vm.dereference(address), 17);
    assert.equal(vm.heap.pins.length, pins);
    assert.equal(vm.heap.stats.allocations, 0);
  }, {maxBytes: 1});
});

test('a throwing host formatter does not consume or rewrite the receiver', () => {
  const failure = new Error('format callback failed');
  class ThrowingVM extends CilVirtualMachine {
    format(value, type) { if (type === 'int') throw failure; return super.format(value, type); }
  }
  withVM(fixture(), vm => {
    pause(vm);
    const address = vm.top.stack[0], pins = vm.heap.pins.length;
    assert.throws(() => vm.step(), error => error === failure);
    assert.equal(vm.top.stack[0], address);
    assert.equal(vm.dereference(address), 17);
    assert.equal(vm.heap.pins.length, pins);
  }, {}, ThrowingVM);
});

for (const call of [{constraint: 'System.Int64'}, {constraint: 'System.UInt32'}, {constraint: 'System.Double'},
  {constraint: 'spec'}, {member: 'GetHashCode'}, {member: 'Equals'}, {explicitThis: true}]) {
  test(`unsupported constrained signature ${JSON.stringify(call)} stays rejected`, () => {
    const report = verifyCilAssembly(fixture(call));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => ['IL_PREFIX', 'IL_TOKEN'].includes(issue.code)));
  });
}

test('metadata replacement rebuilds the exact primitive constraint plan', () => {
  const bytes = fixture();
  withVM(bytes, vm => {
    pause(vm);
    vm.inspector = new AssemblyInspector(bytes);
    vm.report = verifyCilAssembly(vm.inspector);
    vm.state = 'running';
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), '17');
  });
});

test('closing a generic constrained parameter over Int32 does not broaden generic body admission', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Apply', genericParameters: [{flags: 24}], parameters: ['!!0&'], result: 'string', body(writer, context) {
      writer.op('ldarg.0').op('constrained.', context.typeSpec('!!0'))
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }},
    {name: 'Main', result: 'string', locals: ['int'], body(writer, context) {
      writer.op('ldloca.s', 0).op('call', context.methodSpec(context.methods.get('Program.Apply'), ['int'])).op('ret');
    }}
  ]}]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.method === 'Program::Apply' && issue.code === 'IL_PREFIX'));
});
