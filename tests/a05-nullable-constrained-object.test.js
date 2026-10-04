import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const nullable = type => `valuetype System.Nullable\`1<${type}>`;
const objectResults = {ToString: 'string', Equals: 'bool', GetHashCode: 'int'};
function objectCall(writer, context, type, name) {
  writer.op('constrained.', context.typeSpec(nullable(type))).op('callvirt',
    context.member('System.Object', name, objectResults[name], name === 'Equals' ? ['object'] : [], false));
}
function construct(writer, context, type) {
  writer.op('newobj', context.member(context.typeSpec(nullable(type)), '.ctor', 'void', ['!0'], false));
}
const print = (writer, context, type) => writer.op('call', context.member('System.Console', 'WriteLine', 'void', [type]));
function fixture(body, locals, types = [], methods = []) {
  return genericCallFixture([...types, {name: 'Program', methods: [{name: 'Main', locals, body}, ...methods]}]);
}
function run(bytes, expected, options = {}) {
  const vm = new CilVirtualMachine(bytes, options);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected);
  } finally { vm.stop(); }
}

test('Roslyn-shaped constrained Nullable Object slots preserve absence and exact underlying box identity', () => {
  const bytes = fixture((writer, context) => {
    const call = name => { objectCall(writer, context, 'int', name); print(writer, context, objectResults[name]); };
    writer.op('ldloca.s', 0); call('ToString');
    writer.op('ldloca.s', 0).op('ldnull'); call('Equals');
    writer.op('ldloca.s', 0).integer(0).op('box', context.resolve('System.Int32')); call('Equals');
    writer.op('ldloca.s', 0); call('GetHashCode');
    writer.integer(23); construct(writer, context, 'int'); writer.op('stloc.0');
    writer.op('ldloca.s', 0); call('ToString');
    writer.op('ldloca.s', 0).integer(23).op('box', context.resolve('System.Int32')); call('Equals');
    writer.op('ldloca.s', 0).op('ldc.i8', 23n).op('box', context.resolve('System.Int64')); call('Equals');
    writer.op('ldloca.s', 0).op('ldnull'); call('Equals');
    writer.op('ldloca.s', 0); call('GetHashCode');
    writer.op('ret');
  }, [nullable('int')]);
  for (const nativeIntBits of [32, 64]) run(bytes, '\nTrue\nFalse\n0\n23\nTrue\nFalse\nFalse\n23\n', {nativeIntBits});
});

test('constrained Nullable text retains Boolean Char and unsigned formatting from the native fixture', () => {
  const types = ['bool', 'bool', 'char', 'uint', 'ulong'];
  const values = [1, 0, 65, -1, -1n];
  const bytes = fixture((writer, context) => {
    for (let index = 0; index < types.length; index++) {
      const type = types[index], value = values[index];
      if (type === 'ulong') writer.op('ldc.i8', value);
      else writer.integer(value);
      construct(writer, context, type);
      writer.op('stloc.s', index).op('ldloca.s', index);
      objectCall(writer, context, type, 'ToString');
      print(writer, context, 'string');
    }
    writer.op('ret');
  }, types.map(nullable));
  run(bytes, 'True\nFalse\nA\n4294967295\n18446744073709551615\n');
});

function counterType() {
  const mutate = (writer, context) => {
    const field = context.fields.get('Counter.Value');
    writer.op('ldarg.0').op('ldarg.0').op('ldfld', field).integer(1).op('add').op('stfld', field);
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
  };
  return {name: 'Counter', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Value', type: 'int'}], methods: [
    {name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
      mutate(writer, context); writer.op('ldstr', 0x70000000 + context.md.userString('counter')).op('ret');
    }},
    {name: 'GetHashCode', static: false, flags: 0xc6, result: 'int', body(writer, context) {
      mutate(writer, context); writer.op('ldarg.0').op('ldfld', context.fields.get('Counter.Value')).op('ret');
    }},
    {name: 'Equals', static: false, flags: 0xc6, result: 'bool', parameters: ['object'], body(writer, context) {
      mutate(writer, context); writer.integer(1).op('ret');
    }}
  ]};
}
function counterFixture() {
  const type = 'valuetype Counter';
  return fixture((writer, context) => {
    const field = context.fields.get('Counter.Value');
    const value = () => {
      writer.op('ldloca.s', 1).op('call', context.member(context.typeSpec(nullable(type)), 'get_Value', '!0', [], false));
      writer.op('ldfld', field); print(writer, context, 'int');
    };
    writer.op('ldloca.s', 0).integer(4).op('stfld', field).op('ldloc.0');
    construct(writer, context, type); writer.op('stloc.1');
    for (const name of ['ToString', 'GetHashCode', 'Equals']) {
      writer.op('ldloca.s', 1);
      if (name === 'Equals') writer.op('ldstr', 0x70000000 + context.md.userString('arbitrary object'));
      objectCall(writer, context, type, name); print(writer, context, objectResults[name]); value();
    }
    writer.op('ldloca.s', 1).op('ldnull'); objectCall(writer, context, type, 'Equals'); print(writer, context, 'bool'); value();
    // Roslyn's in-receiver path copies the wrapper before obtaining its writable address.
    writer.op('ldloc.1').op('stloc.2').op('ldloca.s', 2);
    objectCall(writer, context, type, 'ToString'); print(writer, context, 'string'); value();
    writer.op('ret');
  }, [type, nullable(type), nullable(type)], [counterType()]);
}
const counterOutput = 'counter\n5\n6\n6\nTrue\n7\nFalse\n7\ncounter\n7\n';

test('constrained Nullable overrides mutate the original payload while copied wrappers remain independent', () => {
  run(counterFixture(), counterOutput, {gcStress: 'instruction', weakStringInterning: true});
});

test('constrained Nullable managed override retains its original interior receiver through snapshot replay', () => {
  const vm = new CilVirtualMachine(counterFixture(), {weakStringInterning: true});
  try {
    for (let count = 0; count < 100 && vm.top.method.owner !== 'Counter'; count++) {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    }
    assert.equal(vm.top.method.owner, 'Counter');
    assert.equal(vm.top.method.name, 'ToString');
    assert(vm.top.args[0].path.includes('nullableValue'));
    const snapshot = vm.snapshot();
    vm.heap.collect();
    assert.equal(vm.run().output, counterOutput);
    vm.stop();
    vm.restore(snapshot);
    vm.heap.collect();
    const replay = vm.run();
    assert.equal(replay.state, 'terminated', replay.fault?.stack);
    assert.equal(replay.output, counterOutput);
  } finally { vm.stop(); }
});

test('a symbolic Nullable<T> constrained call resolves the executing closed generic method context', () => {
  const bytes = fixture((writer, context) => {
    writer.integer(23); construct(writer, context, 'int'); writer.op('stloc.0').op('ldloca.s', 0);
    writer.op('call', context.methodSpec(context.methods.get('Program.Read'), ['int']));
    print(writer, context, 'string'); writer.op('ret');
  }, [nullable('int')], [], [{name: 'Read', result: 'string', genericParameters: [{flags: 24}],
    parameters: [nullable('!!0') + '&'], body(writer, context) {
      writer.op('ldarg.0'); objectCall(writer, context, '!!0', 'ToString'); writer.op('ret');
    }}]);
  run(bytes, '23\n');
});

test('constrained Nullable rejects a substituted address with a different declared closed type', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0); objectCall(writer, context, 'int', 'ToString'); writer.op('pop').op('ret');
  }, [nullable('int'), nullable('long')]);
  const vm = new CilVirtualMachine(bytes);
  try {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    vm.top.stack[0] = vm.address('local', 1);
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'InvalidProgramException');
    assert.equal(result.fault.message, 'constrained. receiver storage has a different declared type');
  } finally { vm.stop(); }
});

test('Nullable constrained admission does not accept Object overloads or reference type arguments', () => {
  const overloaded = fixture((writer, context) => writer.op('ldloca.s', 0).integer(1)
    .op('constrained.', context.typeSpec(nullable('int')))
    .op('callvirt', context.member('System.Object', 'Equals', 'bool', ['int'], false)).op('pop').op('ret'), [nullable('int')]);
  assert.throws(() => new CilVirtualMachine(overloaded), {name: 'CilError'});
  const reference = fixture((writer, context) => {
    writer.op('ldloca.s', 0); objectCall(writer, context, 'object', 'ToString'); writer.op('pop').op('ret');
  }, [nullable('object')]);
  assert.throws(() => new CilVirtualMachine(reference), {name: 'CilError'});
});
