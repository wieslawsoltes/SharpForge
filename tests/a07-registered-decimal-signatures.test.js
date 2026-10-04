import test from 'node:test';
import assert from 'node:assert/strict';
import * as framework from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {intrinsicDefinition, intrinsicKey} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {createContractResolver} from '../packages/framework/src/member-signatures.js';
import {managedFixture} from './managed-fixtures.js';
import {decimalSignature, emitDecimal} from './a05-decimal-fixtures.js';

const descriptor = (owner, name, parameters, returnType, isStatic = false) => ({
  kind: 'method', owner, name,
  signature: {parameters, returnType, isStatic, genericArity: 0, callingConvention: 0}
});

function isolatedRegistry() {
  const registry = framework.createRegistry({reservations: [{name: 'test', start: 0, size: 3}]});
  registry.register({name: 'test', register({define, member, ctor}) {
    define('System.Decimal', {kind: 'value', base: 'System.ValueType'});
    define('Fixture.DecimalReceiver', {kind: 'bcl'});
    member('Fixture.DecimalReceiver', 'Keyword', ['decimal'], 'decimal');
    member('Fixture.DecimalReceiver', 'Clr', ['System.Decimal'], 'System.Decimal');
    ctor('Fixture.DecimalReceiver', ['decimal']);
  }});
  const find = (owner, name, isStatic) => (registry.memberIndex.get(owner + '::' + name) ?? [])
    .filter(contract => isStatic === undefined || contract.isStatic === isStatic);
  return {registry, resolve: createContractResolver(find, registry.canonicalType)};
}

test('registered Decimal signatures match keyword and CLR spellings symmetrically without changing type identity', () => {
  const {registry, resolve} = isolatedRegistry();
  for (const [index, name] of ['Keyword', 'Clr'].entries()) {
    for (const parameter of ['decimal', 'System.Decimal']) {
      for (const result of ['decimal', 'System.Decimal']) {
        assert.equal(resolve(descriptor('DecimalReceiver', name, [parameter], result)), registry.contracts[index]);
      }
    }
  }
  assert.equal(resolve(descriptor('Fixture.DecimalReceiver', '.ctor', ['System.Decimal'], 'void')), registry.contracts[2]);
  for (const spelling of ['decimal', 'System.Decimal']) {
    assert.equal(registry.canonicalType(spelling), spelling);
    assert.equal(framework.canonicalType(spelling), spelling);
  }
  assert.equal(framework.memberSignatureType('System.Decimal'), 'decimal');
  for (const spelling of ['decimal', 'System.Decimal&', 'System.Decimal*', 'System.Decimal[]', 'Other.Decimal']) {
    assert.equal(framework.memberSignatureType(spelling), spelling);
  }
});

test('registered Decimal signature matching retains owner, return, staticness, arity and byref boundaries', () => {
  const {resolve} = isolatedRegistry();
  const valid = descriptor('Fixture.DecimalReceiver', 'Keyword', ['System.Decimal'], 'System.Decimal');
  for (const candidate of [
    {...valid, owner: 'Other.DecimalReceiver'},
    {...valid, name: 'Unknown'},
    {...valid, signature: {...valid.signature, returnType: 'double'}},
    {...valid, signature: {...valid.signature, returnType: 'System.Decimal&'}},
    {...valid, signature: {...valid.signature, isStatic: true}},
    {...valid, signature: {...valid.signature, parameters: []}},
    {...valid, signature: {...valid.signature, parameters: ['System.Decimal', 'System.Decimal']}},
    ...['double', 'System.Decimal&', 'decimal&', 'System.Decimal*', 'System.Decimal[]', 'Other.Decimal']
      .map(type => ({...valid, signature: {...valid.signature, parameters: [type]}}))
  ]) assert.equal(resolve(candidate), null, JSON.stringify(candidate));
  assert.equal(resolve(null), null);
  assert.equal(resolve({}), null);
});

test('builtin Decimal constructor, arithmetic and Console retain their original intrinsic keys and strict signatures', () => {
  const cases = [
    [descriptor('System.Decimal', '.ctor', ['int', 'int', 'int', 'bool', 'byte'], 'void'), 'decimal'],
    [descriptor('System.Decimal', 'Add', ['System.Decimal', 'System.Decimal'], 'System.Decimal', true), 'decimal'],
    [descriptor('System.Console', 'WriteLine', ['System.Decimal'], 'void', true), 'console']
  ];
  for (const [call, implementation] of cases) {
    const definition = intrinsicDefinition(call);
    assert.equal(definition?.implementation, implementation);
    assert.equal(definition.key, intrinsicKey(call));
    assert.equal(definition.contract, null);
    assert(definition.key.includes('System.Decimal'));
    assert.equal(intrinsicDefinition({...call, signature: {...call.signature, returnType: 'Unsupported.Return'}}), null);
    assert.equal(intrinsicDefinition({...call, signature: {...call.signature, isStatic: !call.signature.isStatic}}), null);
    assert.equal(intrinsicDefinition({...call, signature: {...call.signature, parameters: [...call.signature.parameters, 'int']}}), null);
  }
  const add = cases[1][0];
  assert.equal(intrinsicDefinition({...add, signature: {...add.signature, parameters: ['System.Decimal&', 'System.Decimal']}}), null);
  assert.equal(framework.contractForMember(cases[1][0]), null);
});

test('independent CIL still constructs exact Decimal values, adds them and writes through the builtin Console path', () => {
  const assembly = managedFixture({methods: [{name: 'Main', result: 'void', maxStack: 6, body(writer, context) {
    emitDecimal(writer, context, 12300, 4);
    emitDecimal(writer, context, 200, 4);
    writer.op('call', context.member('System.Decimal', 'Add', decimalSignature, [decimalSignature, decimalSignature]));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', [decimalSignature]));
    writer.op('ret');
  }}]});
  const vm = new CilVirtualMachine(assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '1.2500\n');
  } finally { vm.stop(); }
});

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`registered signature normalization ${pipeline}/${engine}: existing Decimal output and framework Double calls stay distinct`, () => {
      const program = compileToIL(`using System;
        decimal first = 1.2300m; decimal second = 0.0200m;
        Console.WriteLine(first + second); Console.WriteLine(Math.Sin(0.0));
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1.2500\n0\n');
      } finally { vm.stop(); }
    });
  }
}
