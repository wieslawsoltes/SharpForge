import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, isSizeOfOnlyMethod, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {instantiatedMethod} from '../packages/runtime/src/execution/generics.js';
import {invalidateExecutionCode} from '../packages/runtime/src/execution/code-version.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const cell = {name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
  fields: [{name: 'Tag', type: 'byte'}, {name: 'Value', type: '!0'}], methods: []};
const managed = {name: 'Managed', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'Reference', type: 'object'}], methods: []};
const sizeofBody = operand => (writer, context) => writer.op('nop')
  .op('sizeof', context.typeSpec(operand)).op('nop').op('ret');

function fixture({argument = 'valuetype Cell`1<int>', operand = '!!0', query = {}, owner = false,
  initialize = false, ownerInitializer = false, ownerFlags = cell.flags, constraint, extraTypes = []} = {}) {
  const method = {name: owner ? 'ElementSize' : 'Size', result: 'int', genericParameters: owner ? [] : [{}],
    body: sizeofBody(owner ? '!0' : operand), ...query};
  const methods = [{name: 'Main', result: 'int', body(writer, context) {
    const target = owner
      ? context.member(context.typeSpec('valuetype Cell`1<' + argument + '>'), 'ElementSize', 'int')
      : context.methodSpec(context.methods.get('Program.Size'), [argument]);
    writer.op('call', target).op('ret');
  }}];
  if (!owner) methods.push(method);
  if (initialize) methods.push({name: '.cctor', body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString('initialized'))
      .op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret');
  }});
  const ownerMethods = owner ? [method] : [];
  if (ownerInitializer) ownerMethods.push({name: '.cctor', body: writer => writer.op('ret')});
  return genericCallFixture([{...cell, flags: ownerInitializer ? 0x109 : ownerFlags, methods: ownerMethods}, managed, ...extraTypes,
    {name: 'Program', flags: initialize ? 0x1 : 0x100001, methods}], {decorate(context) {
      if (!constraint) return;
      const token = owner ? context.types.get('Cell`1') : context.methods.get('Program.Size');
      const parameter = context.md.rows[42].findIndex(row => row[2] === codedIndex('TypeOrMethodDef', token));
      context.md.add(44, [parameter + 1, codedIndex('TypeDefOrRef', context.resolve(constraint))]);
    }});
}

function withVM(bytes, callback, options) {
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

for (const nativeIntBits of [32, 64]) {
  test(`sizeof-only MethodSpec queries accept supported struct, Nullable and reference layouts on ABI${nativeIntBits}`, () => {
    for (const [argument, expected] of [
      ['valuetype Cell`1<int>', 8], ['valuetype Cell`1<long>', 16],
      ['valuetype Cell`1<valuetype Cell`1<int>>', 12], ['valuetype Managed', nativeIntBits / 8],
      ['System.Nullable`1<byte>', 2], ['System.Nullable`1<valuetype Cell`1<int>>', 12],
      ['string', nativeIntBits / 8], ['int[]', nativeIntBits / 8], ['int', 4]
    ]) withVM(fixture({argument}), vm => {
      const allocations = vm.heap.stats.allocations;
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.returnValue, expected, argument);
      assert.equal(vm.heap.stats.allocations, allocations, 'The query needs no aggregate value or box');
    }, {nativeIntBits});
  });

  test(`sizeof-only methods on closed struct owners resolve !0 independently on ABI${nativeIntBits}`, () => {
    for (const [argument, expected] of [['long', 8], ['string', nativeIntBits / 8], ['valuetype Cell`1<int>', 8]]) {
      withVM(fixture({owner: true, argument}), vm => {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.returnValue, expected);
      }, {nativeIntBits});
    }
    withVM(fixture({operand: 'valuetype Cell`1<!!0>'}), vm => {
      assert.equal(vm.run().returnValue, 12, 'The operand can wrap a closed aggregate method argument');
    }, {nativeIntBits});
  });
}

test('ordinary declaring-type initialization remains reachable and runs before the generic query', () => {
  withVM(fixture({initialize: true}), vm => {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, 'initialized\n');
    assert.equal(result.returnValue, 8);
  });
});

test('a required generic aggregate initializer still runs before a sizeof-only query', () => {
  withVM(fixture({owner: true, argument: 'int', ownerInitializer: true}), vm => {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 4);
  });
});

test('layout-only arguments retain reference, value and metadata base constraints', () => {
  for (const options of [
    {query: {genericParameters: [{flags: 4}]}},
    {argument: 'System.Nullable`1<int>', query: {genericParameters: [{flags: 8}]}},
    {constraint: 'System.IDisposable'},
    {owner: true, constraint: 'System.IDisposable'}
  ]) withVM(fixture(options), vm => assert.equal(vm.run().fault?.name, 'ArgumentException'));
});

test('layout admission preserves explicit unsupported layouts and malformed layout faults', () => {
  const auto = {name: 'Auto', base: 'System.ValueType', flags: 0x100101,
    fields: [{name: 'Value', type: 'int'}], methods: []};
  const explicit = {...auto, name: 'Explicit', flags: 0x100111};
  for (const [argument, extraTypes, fault] of [
    ['valuetype Auto', [auto], 'NotSupportedException'],
    ['valuetype Explicit', [explicit], 'TypeLoadException'],
    ['External.Unregistered', [], 'NotSupportedException']
  ]) withVM(fixture({argument, extraTypes}), vm => assert.equal(vm.run().fault?.name, fault));
  for (const [ownerFlags, fault] of [[0x100101, 'NotSupportedException'], [0x100111, 'TypeLoadException']]) {
    withVM(fixture({owner: true, argument: 'int', ownerFlags}), vm => assert.equal(vm.run().fault?.name, fault));
  }
});

for (const [name, query] of [
  ['parameter', {parameters: ['int']}],
  ['aggregate result', {result: '!!0'}],
  ['local', {locals: ['int']}],
  ['instance', {static: false}],
  ['unreachable suffix', {body(writer, context) { sizeofBody('!!0')(writer, context); writer.op('ldc.i4.0').op('pop'); }}],
  ['branch', {body(writer, context) {
    writer.op('br', 'query').mark('query').op('sizeof', context.typeSpec('!!0')).op('ret');
  }}],
  ['storage', {body(writer, context) {
    writer.op('ldnull').op('unbox.any', context.typeSpec('!!0')).op('pop'); sizeofBody('!!0')(writer, context);
  }}],
  ['constant body', {body: writer => writer.op('ldc.i4.4').op('ret')}]
]) test(`sizeof-only classification excludes ${name} bodies after general aggregate admission`, () => {
  const bytes = fixture({query}), inspector = new AssemblyInspector(bytes);
  const method = [...inspector.methods.values()].find(method => method.name === 'Size');
  assert.equal(isSizeOfOnlyMethod(inspector, method.token), false);
});

test('ordinary methods on closed aggregate owners use the general storage profile', () => {
  withVM(fixture({owner: true, argument: 'int',
    query: {body: writer => writer.op('ldc.i4.4').op('ret')}}), vm => {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 4);
  });
});

test('sizeof-only classification never replaces maxstack, token or generic operand validation', () => {
  for (const [options, code] of [
    [{query: {maxStack: 0}}, 'IL_STACK'], [{operand: '!!1'}, 'IL_TYPE'],
    [{query: {body: (writer, context) => writer.op('sizeof', context.methods.get('Program.Main')).op('ret')}}, 'IL_TOKEN']
  ]) {
    const report = verifyCilAssembly(fixture(options));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === code), JSON.stringify(report.issues));
  }
});

test('the public metadata predicate is bounded and rejects non-MethodDef tokens', () => {
  for (const padding of [4094, 4095]) {
    const inspector = new AssemblyInspector(fixture({query: {body(writer, context) {
      for (let index = 0; index < padding; index++) writer.op('nop');
      writer.op('sizeof', context.typeSpec('!!0')).op('ret');
    }}}));
    const method = [...inspector.methods.values()].find(method => method.name === 'Size');
    assert.equal(isSizeOfOnlyMethod(inspector, method.token), padding === 4094);
    for (const token of [null, -1, 0x02000002, 0x0600ffff]) assert.equal(isSizeOfOnlyMethod(inspector, token), false);
  }
});

test('exception handlers and non-managed headers are never ignored by sizeof-only classification', () => {
  const inspector = new AssemblyInspector(fixture());
  const token = [...inspector.methods.values()].find(method => method.name === 'Size').token;
  const method = inspector.getMethod(token);
  for (const override of [
    {handlers: [{flags: 2}]}, {implFlags: 4}, {implFlags: 0x1000}, {flags: method.flags | 0x400},
    {signature: {...method.signature, callingConvention: 5}}
  ]) {
    const metadata = {methods: inspector.methods, getMethod: () => ({...method, ...override})};
    assert.equal(isSizeOfOnlyMethod(metadata, token), false);
  }
});

test('closed query frames replay snapshots without creating aggregate values or fresh method identities', () => {
  withVM(fixture(), vm => {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity,
      onInstruction: (_instruction, frame) => frame.method.name === 'Size'});
    assert.equal(vm.state, 'paused');
    assert.deepEqual(vm.top.args, []);
    assert.deepEqual(vm.top.locals, []);
    const method = vm.top.method;
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      assert.equal(vm.top.method, method);
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 8);
    }
  });
});

test('query admission follows canonical body and execution epoch instead of a stale method token', () => {
  withVM(fixture(), vm => {
    const token = [...vm.inspector.methods.values()].find(method => method.name === 'Size').token;
    const first = instantiatedMethod(vm, token, null, ['Cell`1<int>']);
    assert.equal(instantiatedMethod(vm, token, null, ['Cell`1<int>']), first);
    assert.notEqual(instantiatedMethod(vm, token, null, ['Cell`1<long>']), first);
    invalidateExecutionCode(vm, 'committed-query-edit');
    assert.notEqual(instantiatedMethod(vm, token, null, ['Cell`1<int>']), first);
    vm.inspector = new AssemblyInspector(fixture({query: {body: writer => writer.op('ldc.i4.4').op('ret')}}));
    assert.equal(isSizeOfOnlyMethod(vm.inspector, token), false);
    const changed = instantiatedMethod(vm, token, null, ['Cell`1<int>']);
    assert.notEqual(changed, first);
    assert.equal(changed.signature.returnType, 'int');
  });
});
