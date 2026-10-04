import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function constructor(base) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const method = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', method).op('ret');
  }};
}

function fixture({owner = false, interfaceCall = false, bound = true, variable, main} = {}) {
  const parameter = owner ? '!0' : '!!0', genericName = owner ? 'Generic`1' : 'Generic';
  const declaration = interfaceCall ? 'IAdjust' : 'Base';
  const bump = (factor, flags) => ({name: 'Bump', static: false, flags, parameters: ['int'], result: 'int', body(writer, context) {
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    const field = context.fields.get('Base.X');
    writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('ldc.i4', factor).op('mul').op('add').op('stfld', field);
    writer.op('ldarg.0').op('ldfld', field).op('ret');
  }});
  const genericParameters = [{flags: bound ? 4 : 0}];
  const apply = {name: 'Apply', parameters: [parameter + '&', 'int'], result: 'int',
    ...(!owner ? {genericParameters} : {}), body(writer, context) {
      writer.op('ldarg.0').op('ldarg.1').op('constrained.', context.typeSpec(variable ?? parameter));
      writer.op('callvirt', context.methods.get(declaration + '.Bump')).op('ret');
    }};
  const call = (context, argument) => owner
    ? context.member(context.typeSpec(genericName + '<' + argument + '>'), 'Apply', 'int', ['!0&', 'int'])
    : context.methodSpec(context.methods.get(genericName + '.Apply'), [argument]);
  return genericCallFixture([
    {name: 'IAdjust', interface: true, flags: 0xa1,
      methods: [{name: 'Bump', static: false, flags: 0x5c6, parameters: ['int'], result: 'int'}]},
    {name: 'Base', interfaces: ['IAdjust'], fields: [{name: 'X', type: 'int'}], methods: [constructor(), bump(1, 0x1c6)]},
    {name: 'Alpha', base: 'Base', methods: [constructor('Base'), bump(2, 0xc6)]},
    {name: 'Beta', base: 'Base', methods: [constructor('Base'), bump(3, 0xc6)]},
    {name: 'Other', methods: [constructor()]},
    {name: 'Box`1', genericParameters: [{}], methods: []},
    {name: genericName, ...(owner ? {genericParameters} : {}), methods: [apply]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['Alpha', 'Beta', 'Base', 'int', 'Box`1<int>', 'Other'],
      body(writer, context) {
        if (main) { main(writer, context, argument => call(context, argument)); return; }
        writer.op('newobj', context.methods.get('Alpha..ctor')).op('stloc.0');
        writer.op('newobj', context.methods.get('Beta..ctor')).op('stloc.1');
        writer.op('ldloca.s', 0).op('ldc.i4.2').op('call', call(context, 'Alpha')).op('ldc.i4', 100).op('mul');
        writer.op('ldloca.s', 1).op('ldc.i4.3').op('call', call(context, 'Beta')).op('ldc.i4.s', 10).op('mul').op('add');
        writer.op('ldloca.s', 0).op('ldc.i4.1').op('call', call(context, 'Alpha')).op('add').op('ret');
      }}]}
  ], {decorate(context) {
    if (!bound) return;
    const target = owner ? context.types.get(genericName) : context.methods.get(genericName + '.Apply');
    const encoded = codedIndex('TypeOrMethodDef', target);
    const row = context.md.rows[42].findIndex(parameter => parameter[2] === encoded && parameter[0] === 0);
    context.md.add(44, [row + 1, codedIndex('TypeDefOrRef', context.resolve(declaration))]);
  }});
}

function withVM(bytes, callback, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

for (const owner of [false, true]) for (const interfaceCall of [false, true]) {
  test(`constrained ${owner ? '!0' : '!!0'} preserves closed ${interfaceCall ? 'interface' : 'class'} dispatch`, () => {
    for (const inlineCaches of [false, true]) withVM(fixture({owner, interfaceCall}), vm => {
      const allocations = vm.heap.stats.allocations;
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 496);
      assert.equal(vm.heap.stats.allocations - allocations, 2, 'only explicit Alpha and Beta objects are allocated');
    }, {inlineCaches});
  });
}

function pauseAtConstraint(vm) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
    return instruction.name === 'callvirt' && frame.method.instructions[frame.pc - 1]?.name === 'constrained.';
  }});
  assert.equal(vm.state, 'paused');
}

for (const owner of [false, true]) test(`snapshot retains the concrete ${owner ? 'owner' : 'method'} generic context`, () => {
  withVM(fixture({owner}), vm => {
    pauseAtConstraint(vm);
    const arguments_ = owner ? vm.top.method.typeArguments : vm.top.method.methodArguments;
    assert.deepEqual(arguments_, ['Alpha']);
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.state = 'running';
      vm.heap.collect();
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 496);
    }
    vm.restore(snapshot);
    const address = vm.top.stack[0];
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  });
});

for (const owner of [false, true]) for (const replacement of [[], ['Beta']]) {
  test(`constrained call rejects ${replacement.length ? 'wrong' : 'missing'} ${owner ? 'owner' : 'method'} context`, () => {
    withVM(fixture({owner}), vm => {
      pauseAtConstraint(vm);
      const field = owner ? 'typeArguments' : 'methodArguments';
      vm.top.method = {...vm.top.method, [field]: Object.freeze(replacement)};
      vm.state = 'running';
      assert.equal(vm.run().fault?.name, 'InvalidProgramException');
    });
  });
}

test('a base-typed slot containing Alpha does not satisfy the exact Alpha byref constraint', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('newobj', context.methods.get('Alpha..ctor')).op('stloc.2');
    writer.op('ldloca.s', 2).op('ldc.i4.1').op('call', call('Alpha')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'InvalidProgramException'));
});

test('existing GenericParam constraints reject incompatible closed types before invocation', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('ldloca.s', 5).op('ldc.i4.1').op('call', call('Other')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'ArgumentException'));
});

test('null remains an ordinary managed callvirt fault after valid parameter substitution', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('ldloca.s', 0).op('ldc.i4.1').op('call', call('Alpha')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'NullReferenceException'));
});

for (const [argument, local] of [['int', 3], ['Box`1<int>', 4]]) {
  test(`parameter substitution does not admit unsupported closed receiver ${argument}`, () => {
    withVM(fixture({bound: false, main(writer, context, call) {
      writer.op('ldloca.s', local).op('ldc.i4.1').op('call', call(argument)).op('ret');
    }}), vm => assert.equal(vm.run().fault?.name, 'NotSupportedException'));
  });
}

for (const [owner, variable] of [[false, '!!1'], [true, '!1'], [false, '!0'], [true, '!!0']]) {
  test(`metadata rejects out-of-context constrained ${variable} (generic owner=${owner})`, () => {
    const report = verifyCilAssembly(fixture({owner, variable}));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.message.includes('outside its declaring context')), JSON.stringify(report.issues));
  });
}

test('calling the generic method without a MethodSpec remains rejected', () => {
  const bytes = fixture({main(writer, context) {
    writer.op('ldloca.s', 0).op('ldc.i4.1').op('call', context.methods.get('Generic.Apply')).op('ret');
  }});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.message.includes('MethodSpec')));
});
