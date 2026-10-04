import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL, compileToAssembly} from '@sharpforge/compiler';
import {createRegistry, types, frameworkType} from '@sharpforge/framework';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {AssemblyInspector, decodeCoded} from '@sharpforge/cil';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {SymbolKind} from '../packages/compiler/src/symbols/types.js';
import {fieldOwner, readonlyFields, readonlyRegistry, installReadonlyProfile} from './fixtures/a07/readonly-fields.js';

test('readonly fields: symbols expose exact static readonly fields without accessors or constant flags', () => {
  const registry = readonlyRegistry();
  const bridge = new RegistryBridge({types: registry.types, contracts: [], builtins: []});
  const owner = bridge.typeFromName(fieldOwner);
  for (const [name, type] of [['Frequency', 'long'], ['IsHighResolution', 'bool']]) {
    const [field] = owner.getMembers(name);
    assert.equal(field.kind, SymbolKind.Field);
    assert.equal(field.containingType, owner);
    assert.equal(field.type, bridge.typeFromName(type));
    assert.equal(field.isStatic, true);
    assert.equal(field.isReadOnly, true);
    assert.equal(field.isConst, false);
    assert.equal(field.hasConstantValue, false);
    assert.equal(field.constantValue, undefined);
    assert.deepEqual(owner.getMembers('get_' + name), []);
  }
  assert.equal(registry.contracts.length, 0);
});

test('readonly fields: copied descriptors and scalar payloads remain immutable and JSON-safe', () => {
  const fields = readonlyFields();
  const registry = createRegistry();
  registry.define(fieldOwner, {fields});
  fields.Frequency.value.value = '1';
  fields.IsHighResolution.value = false;
  const actual = registry.frameworkType(fieldOwner).fields;
  assert.equal(actual.Frequency.value.value, '1000000000');
  assert.equal(actual.IsHighResolution.value, true);
  for (const value of [actual, actual.Frequency, actual.Frequency.value, actual.Frequency.assemblies]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => { actual.Frequency.value.value = '2'; }, TypeError);
  const restored = JSON.parse(JSON.stringify([...registry.types.values()]));
  assert.equal(restored[0].fields.Frequency.value.value, '1000000000');
});

for (const target of ['field map', 'type', 'scalar value', 'assembly scope']) {
  test(`readonly fields: ${target} accessors are rejected without invoking host code`, () => {
    const registry = readonlyRegistry();
    const before = JSON.stringify([...registry.types.values()]);
    const fields = readonlyFields();
    const descriptor = fields.Frequency;
    let reads = 0;
    const accessor = {enumerable: true, get() { reads++; return {}; }};
    if (target === 'field map') Object.defineProperty(fields, 'Frequency', accessor);
    if (target === 'type') Object.defineProperty(descriptor, 'type', accessor);
    if (target === 'scalar value') Object.defineProperty(descriptor.value, 'value', accessor);
    if (target === 'assembly scope') Object.defineProperty(descriptor.assemblies, '0', accessor);
    assert.throws(() => registry.register({name: 'fixture', register(target) {
      target.frameworkType(fieldOwner).fields = fields;
    }}), /readonly field/);
    assert.equal(reads, 0);
    assert.equal(JSON.stringify([...registry.types.values()]), before);
  });
}

for (const [name, change] of [
  ['mutable', field => { field.readOnly = false; }],
  ['instance', field => { field.isStatic = false; }],
  ['inexact number', field => { field.value = 1000000000; }],
  ['wrong scalar type', field => { field.value.scalar = 'ulong'; }],
  ['out of range', field => { field.value.value = '9223372036854775808'; }],
  ['host object', field => { field.value = {callback() { return 1; }}; }],
  ['CoreLib-only scope', field => { field.assemblies = ['System.Private.CoreLib']; }],
  ['duplicate scope', field => { field.assemblies = ['System.Runtime', 'System.Runtime']; }],
  ['unknown scope', field => { field.assemblies = ['Lookalike.Core']; }]
]) {
  test(`readonly fields: ${name} descriptors fail transactionally and can be retried`, () => {
    const registry = readonlyRegistry();
    const before = JSON.stringify([...registry.types.values()]);
    assert.throws(() => registry.register({name: 'fixture', register(target) {
      const fields = readonlyFields();
      change(fields.Frequency);
      target.frameworkType(fieldOwner).fields = fields;
      target.define('Fixture.Temporary');
    }}), /readonly field/);
    assert.equal(JSON.stringify([...registry.types.values()]), before);
    assert.equal(registry.frameworkType('Fixture.Temporary'), null);
    registry.register({name: 'fixture', register(target) {
      target.frameworkType(fieldOwner).fields = readonlyFields();
    }});
    assert.equal(registry.validate(), true);
  });
}

const readSource = `using System;
class Program {
  static void Main() {
    long frequency = ${fieldOwner}.Frequency;
    bool high = ${fieldOwner}.IsHighResolution;
    long maximum = ${fieldOwner}.Maximum;
    Console.WriteLine(frequency == 1000000000L);
    Console.WriteLine(high);
    Console.WriteLine(maximum == 9223372036854775807L);
  }
}`;

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'profile-cil']) {
    test(`readonly fields: ${pipeline}/${engine} lowers exact profile values after binding`, context => {
      installReadonlyProfile(context);
      const program = engine === 'source' ? compile(readSource, {pipeline}) : compileToIL(readSource, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      if (engine === 'profile-cil') {
        const inspector = new AssemblyInspector(program.assembly);
        const instructions = inspector.types.flatMap(type => type.methods)
          .flatMap(method => inspector.getMethod(method.token).instructions);
        assert(instructions.some(instruction => instruction.name === 'ldc.i8'));
        assert.equal(instructions.some(instruction => instruction.name === 'ldsfld' &&
          inspector.resolveToken(instruction.operand).owner === fieldOwner), false);
      }
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\nTrue\n');
      } finally { vm.stop(); }
    });
  }
  for (const [statement, code] of [
    [`${fieldOwner}.Frequency = 1L;`, 'CS0198'],
    [`${fieldOwner}.Frequency++;`, 'CS0198'],
    [`const long value = ${fieldOwner}.Frequency;`, 'CS0133'],
    [`ref long value = ref ${fieldOwner}.Frequency;`, 'CS0199']
  ]) {
    test(`readonly fields: ${pipeline} preserves ${code} for ${statement}`, context => {
      installReadonlyProfile(context);
      const program = compile(`class Program { static void Main() { ${statement} } }`, {pipeline});
      assert.equal(program.success, false);
      assert(program.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(program.diagnostics));
    });
  }
}

test('readonly fields: direct CIL compiler emits genuine scoped field MemberRefs', context => {
  installReadonlyProfile(context);
  const program = compileToAssembly(`class Program { static int Main() {
    return ${fieldOwner}.Frequency == 1000000000L && ${fieldOwner}.IsHighResolution ? 42 : 0;
  } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  const inspector = new AssemblyInspector(program.assembly);
  const fields = inspector.types.flatMap(type => type.methods).flatMap(method => inspector.getMethod(method.token).instructions)
    .filter(instruction => instruction.name === 'ldsfld').map(instruction => inspector.resolveToken(instruction.operand));
  assert.deepEqual(fields.map(field => [field.owner, field.name, field.signature.type]),
    [[fieldOwner, 'Frequency', 'long'], [fieldOwner, 'IsHighResolution', 'bool']]);
  for (const field of fields) {
    assert.equal(field.token >>> 24, 10);
    const scope = decodeCoded('ResolutionScope', inspector.metadata.row(field.ownerToken)[0]);
    assert.equal(scope >>> 24, 35);
    assert.equal(inspector.metadata.string(inspector.metadata.row(scope)[6]), 'System.Runtime');
  }
  const vm = new CilVirtualMachine(program.assembly);
  try { assert.equal(vm.run().returnValue, 42); } finally { vm.stop(); }
});

for (const pipeline of ['bound', 'legacy']) {
  test(`readonly fields: ${pipeline} same-named source declarations retain their own mutable storage`, context => {
    installReadonlyProfile(context);
    const source = `namespace System.Diagnostics { class ReadonlyFieldProfile { public static long Frequency = 17L; } }
      class Program { static void Main() { ${fieldOwner}.Frequency = 19L;
        System.Console.WriteLine(${fieldOwner}.Frequency == 19L); } }`;
    const program = compile(source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = new VirtualMachine(program.image);
    try { assert.equal(vm.run().output, 'True\n'); } finally { vm.stop(); }
  });

  test(`readonly fields: ${pipeline} locals and parameters shadow framework type aliases`, context => {
    const original = types.get('System.Math');
    types.set('System.Math', {...original, fields: readonlyRegistry().frameworkType(fieldOwner).fields});
    context.after(() => types.set('System.Math', original));
    assert.equal(frameworkType('Math').fields.Frequency.type, 'long');
    const source = `using System;
      class Holder { public long Frequency = 17L; }
      class Program {
        static long Read(Holder Math) {
          Math.Frequency = 19L;
          return Math.Frequency;
        }
        static void Main() {
          Holder Math = new Holder();
          System.Console.WriteLine(Math.Frequency == 17L);
          System.Console.WriteLine(Read(Math) == 19L);
          Math.Frequency = 23L;
          System.Console.WriteLine(Math.Frequency == 23L);
        }
      }`;
    const program = compile(source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = new VirtualMachine(program.image);
    try { assert.equal(vm.run().output, 'True\nTrue\nTrue\n'); } finally { vm.stop(); }
  });
}
