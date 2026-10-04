import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function constructor(base) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', target).op('ret');
  }};
}

function fixture({owner = false, bound = 'Base', parameterFlags = 0, extraBound, variable,
  mode = 'derived', main, decorate, invalidOverride = false, trace = false, unrelatedInvalid = false} = {}) {
  const parameter = owner ? '!0' : '!!0', genericName = owner ? 'Generic`1' : 'Generic';
  const genericParameters = [{flags: parameterFlags}];
  const text = (name, flags = 0xc6) => ({name: 'ToString', static: false, flags, result: 'string', body(writer, context) {
    if (name === 'Beta' && invalidOverride || name === 'Other' && unrelatedInvalid) {
      writer.op('pop').op('ret');
      return;
    }
    const field = context.fields.get('Base.X');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldc.i4.1').op('add').op('stfld', field);
    writer.op('ldstr', 0x70000000 + context.md.userString(name));
    if (trace) writer.op('dup').op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
    writer.op('ret');
  }});
  const apply = {name: 'Apply', parameters: [parameter + '&'], result: 'string',
    ...(!owner ? {genericParameters} : {}), body(writer, context) {
      writer.op('ldarg.0').op('constrained.', context.typeSpec(variable ?? parameter));
      writer.op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }};
  const call = (context, argument) => owner
    ? context.member(context.typeSpec(genericName + '<' + argument + '>'), 'Apply', 'string', ['!0&'])
    : context.methodSpec(context.methods.get(genericName + '.Apply'), [argument]);
  return genericCallFixture([
    {name: 'IMarker', interface: true, flags: 0xa1, methods: []},
    {name: 'Base', fields: [{name: 'X', type: 'int'}], methods: [constructor(),
      ...(mode === 'inherited' || mode === 'newslot' ? [text('Base')] : [])]},
    {name: 'Alpha', base: 'Base', interfaces: ['IMarker'], methods: [constructor('Base'),
      ...(mode === 'derived' || mode === 'newslot' ? [text('Alpha', mode === 'newslot' ? 0x1c6 : 0xc6)] : [])]},
    {name: 'Beta', base: 'Base', methods: [constructor('Base'),
      ...(mode === 'derived' || mode === 'newslot' ? [text('Beta')] : [])]},
    {name: 'Other', methods: [constructor(), ...(unrelatedInvalid ? [text('Other')] : [])]},
    {name: 'Value', flags: 0x100109, base: 'System.ValueType', fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'GenericReceiver`1', genericParameters: [{}], base: 'Base', methods: []},
    {name: genericName, ...(owner ? {genericParameters} : {}), methods: [apply]},
    {name: 'Program', methods: [{name: 'Main', result: 'string', locals: ['Alpha', 'Beta', 'Base', 'Other', 'int',
      'GenericReceiver`1<int>', 'string'], body(writer, context) {
      if (main) { main(writer, context, argument => call(context, argument)); return; }
      writer.op('newobj', context.methods.get('Alpha..ctor')).op('stloc.0');
      writer.op('newobj', context.methods.get('Beta..ctor')).op('stloc.1');
      writer.op('ldloc.1').op('stloc.2');
      const output = context.member('System.Console', 'WriteLine', 'void', ['string']);
      writer.op('ldloca.s', 0).op('call', call(context, 'Alpha')).op('call', output);
      writer.op('ldloca.s', 1).op('call', call(context, 'Beta')).op('call', output);
      writer.op('ldloca.s', 2).op('call', call(context, 'Base')).op('ret');
    }}]}
  ], {decorate(context) {
    const target = owner ? context.types.get(genericName) : context.methods.get(genericName + '.Apply');
    const encoded = codedIndex('TypeOrMethodDef', target);
    const row = context.md.rows[42].findIndex(candidate => candidate[2] === encoded && candidate[0] === 0);
    for (const name of [bound, extraBound].filter(Boolean)) {
      const token = name.includes('<') ? context.typeSpec(name) : context.resolve(name);
      context.md.add(44, [row + 1, codedIndex('TypeDefOrRef', token)]);
    }
    decorate?.(context, row);
  }});
}

function withVM(bytes, callback, options = {}) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pauseAtCall(vm, active = false) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
    return active ? frame.method.name === 'ToString' : instruction.name === 'callvirt';
  }});
  assert.equal(vm.state, 'paused');
}

const expected = {
  fallback: ['Alpha', 'Beta', 'Beta'], inherited: ['Base', 'Base', 'Base'],
  derived: ['Alpha', 'Beta', 'Beta'], newslot: ['Base', 'Beta', 'Beta']
};
for (const owner of [false, true]) for (const mode of Object.keys(expected)) {
  test(`${owner ? '!0' : '!!0'} base bound keeps ${mode} Object dispatch distinct across closed calls`, () => {
    for (const decodePlans of [false, true]) {
      withVM(fixture({owner, mode}), vm => {
        assert.equal(vm.run().state, 'terminated');
        assert.equal(vm.output.join(''), expected[mode].slice(0, 2).join('\n') + '\n');
        assert.equal(vm.format(vm.returnValue), expected[mode][2]);
        assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
        assert.equal(vm.heap.records.find(record => record?.type === 'Beta').data[0], mode === 'fallback' ? 0 : 2);
      }, {decodePlans});
    }
  });
}

for (const owner of [false, true]) for (const active of [false, true]) {
  test(`${owner ? '!0' : '!!0'} snapshot at ${active ? 'override' : 'prefix'} survives replay, epoch change and stop`, () => {
    withVM(fixture({owner}), vm => {
      pauseAtCall(vm, active);
      const receiver = vm.frames[0].locals[0], snapshot = vm.snapshot();
      if (active) assert.deepEqual(vm.top.args[0], receiver);
      for (let replay = 0; replay < 2; replay++) {
        vm.restore(snapshot);
        invalidateExecutionCode(vm, 'generic-object-replay');
        vm.heap.collect();
        vm.state = 'running';
        assert.equal(vm.run().state, 'terminated');
        assert.equal(vm.format(vm.returnValue), 'Beta');
        assert.equal(vm.heap.get(receiver).data[0], 1);
      }
      vm.restore(snapshot);
      vm.stop();
      vm.heap.collect();
      assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
    });
  });
}

for (const owner of [false, true]) for (const context of [[], ['Beta'], ['Other']]) {
  test(`${owner ? '!0' : '!!0'} rejects edited context ${JSON.stringify(context)} before using the receiver`, () => {
    withVM(fixture({owner}), vm => {
      pauseAtCall(vm);
      vm.top.method = {...vm.top.method, [owner ? 'typeArguments' : 'methodArguments']: Object.freeze(context)};
      vm.state = 'running';
      assert.equal(vm.run().fault?.name, 'InvalidProgramException');
    });
  });
}

test('a declared Base slot containing Alpha cannot satisfy ref Alpha', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('newobj', context.methods.get('Alpha..ctor')).op('stloc.2');
    writer.op('ldloca.s', 2).op('call', call('Alpha')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'InvalidProgramException'));
});

test('foreign owned addresses remain rejected after metadata selection is warm', () => {
  const bytes = fixture();
  withVM(bytes, vm => withVM(bytes, other => {
    let count = 0;
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction) {
      return instruction.name === 'callvirt' && ++count === 2;
    }});
    assert.equal(vm.state, 'paused');
    vm.top.stack[0] = other.address('local', 1);
    vm.state = 'running';
    assert.equal(vm.run().fault?.name, 'InvalidProgramException');
  }));
});

for (const owner of [false, true]) test(`existing GenericParam validation enforces the ${owner ? 'type' : 'method'} base bound`, () => {
  withVM(fixture({owner, main(writer, context, call) {
    writer.op('ldloca.s', 3).op('call', call('Other')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'ArgumentException'));
});

test('additional interface bounds keep their existing closed-call validation', () => {
  withVM(fixture({extraBound: 'IMarker'}), vm => {
    assert.equal(vm.run().fault?.name, 'ArgumentException', 'Alpha is accepted, then Beta fails IMarker');
    assert.equal(vm.output.join(''), 'Alpha\n');
  });
});

test('a null receiver retains the managed callvirt fault', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('ldloca.s', 0).op('call', call('Alpha')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'NullReferenceException'));
});

test('a closed generic receiver retains its declaring instance when its base satisfies the bound', () => {
  withVM(fixture({main(writer, context, call) {
    writer.op('ldloca.s', 5).op('call', call('GenericReceiver`1<int>')).op('ret');
  }}), vm => {
    vm.top.locals[5] = vm.heap.object(vm.typeSystem.table('GenericReceiver`1<int>'), [0]);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.format(vm.returnValue), 'GenericReceiver`1[System.Int32]');
  });
});

test('the original reference stays rooted during a generic override host callback', () => {
  let vm, receiver;
  try {
    vm = new CilVirtualMachine(fixture({trace: true}), {onOutput() {
      if (vm.top.method.name !== 'ToString') return;
      receiver = vm.top.args[0];
      const main = vm.frames[0];
      if (vm.heap.get(receiver).type === 'Alpha') main.locals[0] = null;
      vm.heap.collect();
      assert.equal(vm.heap.get(receiver).kind, 'object');
    }});
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Beta');
  } finally { vm?.stop(); }
});

test('verification reaches bound descendants but does not verify unrelated class bodies', () => {
  assert.equal(verifyCilAssembly(fixture({invalidOverride: true})).success, false);
  assert.equal(verifyCilAssembly(fixture({unrelatedInvalid: true})).success, true);
});

for (const [label, options] of [
  ['unconstrained', {bound: null}], ['class-only', {bound: null, parameterFlags: 4}],
  ['struct', {bound: 'Value'}], ['value flag', {parameterFlags: 8}], ['interface-only', {bound: 'IMarker'}],
  ['external', {bound: 'System.Exception'}], ['Object-only', {bound: 'System.Object'}],
  ['generic base', {bound: 'GenericReceiver`1<int>'}], ['two class bounds', {extraBound: 'Alpha'}]
]) test(`${label} Object constraint admits symbolic code while retaining closed-argument constraints`, () => {
  const bytes = fixture(options), report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const admitted = ['unconstrained', 'class-only', 'Object-only'].includes(label);
  withVM(bytes, vm => {
    const result = vm.run();
    if (admitted) {
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.format(vm.returnValue), 'Beta');
    } else assert.equal(result.fault?.name, 'ArgumentException');
  });
});

for (const [owner, variable] of [[false, '!!1'], [true, '!1'], [false, '!0'], [true, '!!0']]) {
  test(`out-of-context ${variable} still fails existing metadata verification (owner=${owner})`, () => {
    const report = verifyCilAssembly(fixture({owner, variable}));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.message.includes('outside its declaring context')));
  });
}

test('duplicate generic ordinals are rejected before runtime dispatch', () => {
  const report = verifyCilAssembly(fixture({decorate(context, row) {
    context.md.add(42, [...context.md.rows[42][row]]);
  }}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /ordinal|arity/.test(issue.message)));
});
