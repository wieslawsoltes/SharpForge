import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly, resolveExecutionField, executionFieldAccessError, fieldSignature, decodeCoded} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {staticSlot} from '../packages/runtime/src/execution/statics.js';
import {fieldOwner, fieldAssemblyIdentities, installReadonlyProfile, fieldAssembly} from './fixtures/a07/readonly-fields.js';
import {managedFixture} from './managed-fixtures.js';
import {decimalField, decimalSignature} from './a05-decimal-fixtures.js';

function execute(bytes) {
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    return result.returnValue;
  } finally { vm.stop(); }
}

for (const [scope, identity] of Object.entries(fieldAssemblyIdentities)) {
  for (const [name, type, value] of [['Frequency', 'long', 1000000000n], ['IsHighResolution', 'bool', true],
    ['Maximum', 'long', 9223372036854775807n]]) {
    test(`readonly fields: direct CIL ${scope} ${name} preserves its exact value and scope`, context => {
      installReadonlyProfile(context);
      const bytes = fieldAssembly({name, type, identity});
      const inspector = new AssemblyInspector(bytes);
      const instruction = inspector.getMethod(inspector.pe.entryPoint).instructions[0];
      const field = resolveExecutionField(inspector, instruction.operand);
      assert.equal(field.owner, fieldOwner);
      assert.equal(field.signature.type, type);
      assert.equal(field.isStatic, true);
      assert.equal(field.isInitOnly, true);
      assert.equal(field.resolvedToken, instruction.operand);
      assert.equal(executionFieldAccessError(field, 'ldsfld'), null);
      const scope = decodeCoded('ResolutionScope', inspector.metadata.row(field.ownerToken)[0]);
      const reference = inspector.metadata.row(scope);
      assert.equal(inspector.metadata.string(reference[6]), identity.name);
      assert.deepEqual(reference.slice(0, 4), identity.version);
      assert.equal(execute(bytes), value);
    });
  }
}

test('readonly fields: compatible facade versions are admitted without rewriting the original AssemblyRef version', context => {
  installReadonlyProfile(context);
  const identity = {...fieldAssemblyIdentities.runtime, version: [10, 1, 2, 3]};
  const bytes = fieldAssembly({identity});
  const inspector = new AssemblyInspector(bytes);
  assert.equal(verifyCilAssembly(inspector).success, true);
  const instruction = inspector.getMethod(inspector.pe.entryPoint).instructions[0];
  const field = inspector.resolveToken(instruction.operand);
  const scope = decodeCoded('ResolutionScope', inspector.metadata.row(field.ownerToken)[0]);
  const row = inspector.metadata.row(scope);
  assert.equal(inspector.metadata.string(row[6]), identity.name);
  assert.deepEqual(row.slice(0, 4), identity.version);
  assert.equal(execute(bytes), 1000000000n);
});

for (const [reason, options] of [
  ['wrong field name', {name: 'Missing'}],
  ['wrong owner', {owner: 'System.Diagnostics.UnregisteredFieldProfile'}],
  ['owner display collision in the global namespace', {metadataNamespace: '', metadataName: fieldOwner}],
  ['owner display collision in a different namespace', {metadataNamespace: 'System', metadataName: 'Diagnostics.ReadonlyFieldProfile'}],
  ['wrong signature width', {type: 'int'}],
  ['named class signature disguised as a primitive', {type: 'class System.Int64'}],
  ['named value signature disguised as a primitive', {type: 'valuetype System.Int64'}],
  ['required signature modifier', {type: 'long modreq(System.Runtime.CompilerServices.IsVolatile)'}],
  ['optional signature modifier', {type: 'long modopt(System.Runtime.CompilerServices.IsVolatile)'}],
  ['array signature', {type: 'long[]'}],
  ['assembly lookalike', {identity: {...fieldAssemblyIdentities.runtime, name: 'Lookalike.Runtime'}}],
  ['unapproved facade', {identity: {...fieldAssemblyIdentities.runtime, name: 'System'}}],
  ['unapproved legacy core', {identity: {...fieldAssemblyIdentities.runtime, name: 'mscorlib'}}],
  ['wrong signing token', {identity: {...fieldAssemblyIdentities.runtime, token: '0000000000000000'}}],
  ['unsigned scope', {identity: {...fieldAssemblyIdentities.runtime, token: ''}}],
  ['non-neutral culture', {identity: {...fieldAssemblyIdentities.runtime, culture: 'en-US'}}]
]) {
  test(`readonly fields: direct CIL rejects ${reason}`, context => {
    installReadonlyProfile(context);
    // Keep the entry method valid so only the referenced field carries the intentionally unsupported signature.
    const bytes = fieldAssembly({...options, discardValue: true});
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => ['IL_TOKEN', 'IL_FIELD'].includes(issue.code)), JSON.stringify(report.issues));
    assert.throws(() => new CilVirtualMachine(bytes));
  });
}

test('readonly fields: malformed byref field signatures are rejected by metadata parsing', context => {
  installReadonlyProfile(context);
  // The signature writer refuses FIELD/BYREF/I8; raw bytes exercise the same invalid shape from independent IL.
  const bytes = fieldAssembly({signatureBytes: Uint8Array.of(0x06, 0x10, 0x0a), discardValue: true});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_METADATA' && issue.message === 'Byref is invalid in this signature'),
    JSON.stringify(report.issues));
  assert.throws(() => new CilVirtualMachine(bytes), /Byref is invalid in this signature/);
});

for (const opcode of ['stsfld', 'ldsflda', 'ldfld', 'stfld', 'ldflda']) {
  test(`readonly fields: direct CIL rejects ${opcode} on a nonaddressable readonly static field`, context => {
    installReadonlyProfile(context);
    const bytes = fieldAssembly({opcode});
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_FIELD'), JSON.stringify(report.issues));
    assert.throws(() => new CilVirtualMachine(bytes), /readonly|static access/);
  });
}

test('readonly fields: descriptor-specific address policy permits reads while indirect writes remain rejected', context => {
  installReadonlyProfile(context, {addressable: true});
  const bytes = fieldAssembly({opcode: 'ldsflda'});
  assert.equal(verifyCilAssembly(bytes).success, true);
  const vm = new CilVirtualMachine(bytes);
  try {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    const address = vm.top.stack.at(-1);
    assert.equal(vm.dereference(address), 1000000000n);
    assert.throws(() => vm.dereference(address, true, 1n), /readonly/);
    assert.equal(vm.dereference(address), 1000000000n);
  } finally { vm.stop(); }
});

test('readonly fields: runtime access guards and immutable static values survive snapshot replay', context => {
  installReadonlyProfile(context);
  const bytes = fieldAssembly();
  const vm = new CilVirtualMachine(bytes);
  try {
    const token = vm.top.method.instructions[0].operand;
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.equal(vm.statics.get(token), 1000000000n);
    assert.throws(() => staticSlot(vm, token, vm.top, 'ldsflda'), /managed addresses/);
    assert.throws(() => staticSlot(vm, token, vm.top, 'stsfld'), /readonly/);
    const address = vm.address('static', token);
    assert.throws(() => vm.dereference(address, true, 1n), /readonly/);
    const saved = vm.snapshot();
    assert.equal(vm.run().returnValue, 1000000000n);
    vm.restore(saved);
    assert.equal(vm.statics.get(token), 1000000000n);
    assert.equal(vm.run().returnValue, 1000000000n);
  } finally { vm.stop(); }
});

for (const reference of ['definition', 'member']) {
  test(`readonly fields: a same-named local ${reference} token remains ordinary mutable storage`, context => {
    installReadonlyProfile(context);
    const bytes = managedFixture({fields: [{name: 'Frequency', type: 'long'}],
      methods: [{name: 'Main', result: 'long', body(writer, fixture) {
        const field = reference === 'definition' ? fixture.fields.Frequency :
          fixture.md.member(fixture.type, 'Frequency', fieldSignature('long', fixture.resolve));
        writer.op('ldc.i8', 19n).op('stsfld', field).op('ldsfld', field).op('ret');
      }}], decorate({md}) {
        md.rows[2][1][1] = md.string('ReadonlyFieldProfile');
        md.rows[2][1][2] = md.string('System.Diagnostics');
      }});
    assert.equal(execute(bytes), 19n);
  });
}

test('readonly fields: Decimal field loads, readable addresses, and indirect write rejection retain existing behavior', () => {
  for (const opcode of ['ldsfld', 'ldsflda']) {
    const bytes = managedFixture({methods: [{name: 'Main', result: decimalSignature, body(writer, context) {
      writer.op(opcode, decimalField(context, 'One'));
      if (opcode === 'ldsflda') writer.op('ldobj', context.resolve('System.Decimal'));
      writer.op('ret');
    }}]});
    const vm = new CilVirtualMachine(bytes);
    try {
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.resultDisplay(), '1');
    } finally { vm.stop(); }
  }
  const bytes = managedFixture({methods: [{name: 'Main', result: 'void', body(writer, context) {
    writer.op('ldsflda', decimalField(context, 'One')).op('initobj', context.resolve('System.Decimal')).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().fault?.name, 'InvalidProgramException'); } finally { vm.stop(); }
  assert.equal(executionFieldAccessError({isStatic: true, isInitOnly: true}, 'stsfld'), null);
});
