import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, verifyCilAssembly, fieldSignature, decodeCoded, emitAssembly, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {staticSlot} from '../packages/runtime/src/execution/statics.js';
import {decodeFieldSpan} from '../packages/cil/src/load/field-span.js';
import {managedFixture} from './managed-fixtures.js';
import {fieldReference, fieldAssemblyIdentities} from './fixtures/a07/readonly-fields.js';

function independentField(options = {}) {
  const opcode = options.opcode ?? 'ldsfld';
  return managedFixture({methods: [{name: 'Main', result: 'void', body(writer, context) {
    const field = fieldReference(context, {owner: 'System.Boolean', name: 'TrueString', type: 'string', ...options});
    if (['ldfld', 'stfld', 'ldflda'].includes(opcode)) writer.op('ldnull');
    if (opcode === 'stsfld' || opcode === 'stfld') writer.op('ldnull');
    writer.op(opcode, field);
    if (!['stfld', 'stsfld'].includes(opcode)) writer.op('pop');
    writer.op('ret');
  }}]});
}

for (const [reason, options] of [
  ['unknown field', {name: 'Missing'}],
  ['unknown owner', {owner: 'System.BooleanLookalike'}],
  ['owner display collision', {metadataName: 'System.Boolean', metadataNamespace: ''}],
  ['wrong primitive', {type: 'object'}],
  ['named class disguised as primitive string', {type: 'class System.String'}],
  ['named value type disguised as primitive string', {type: 'valuetype System.String'}],
  ['array', {type: 'string[]'}],
  ['required modifier', {type: 'string modreq(System.Runtime.CompilerServices.IsVolatile)'}],
  ['optional modifier', {type: 'string modopt(System.Runtime.CompilerServices.IsVolatile)'}],
  ['wrong assembly', {identity: {...fieldAssemblyIdentities.runtime, name: 'Lookalike.Runtime'}}],
  ['unapproved legacy core', {identity: {...fieldAssemblyIdentities.runtime, name: 'mscorlib', token: 'b77a5c561934e089'}}],
  ['wrong token', {identity: {...fieldAssemblyIdentities.runtime, token: '0000000000000000'}}],
  ['unsigned identity', {identity: {...fieldAssemblyIdentities.runtime, token: ''}}],
  ['non-neutral culture', {identity: {...fieldAssemblyIdentities.runtime, culture: 'en-US'}}]
]) {
  test(`Boolean fields CIL: ${reason} fails at field admission with a valid entry-method signature`, () => {
    const bytes = independentField(options);
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => ['IL_FIELD', 'IL_TOKEN'].includes(issue.code)), JSON.stringify(report.issues));
    assert.throws(() => new CilVirtualMachine(bytes));
  });
}

test('Boolean fields CIL: malformed byref field data is rejected by the metadata parser', () => {
  const bytes = independentField({signatureBytes: Uint8Array.of(0x06, 0x10, 0x0e)});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_METADATA' && issue.message === 'Byref is invalid in this signature'));
  assert.throws(() => new CilVirtualMachine(bytes), /Byref is invalid in this signature/);
});

for (const opcode of ['stsfld', 'ldsflda', 'ldfld', 'stfld', 'ldflda']) {
  test(`Boolean fields CIL: ${opcode} cannot write, take an address or substitute instance access`, () => {
    const bytes = independentField({opcode});
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_FIELD'), JSON.stringify(report.issues));
    assert.throws(() => new CilVirtualMachine(bytes), /readonly|static access/);
  });
}

test('Boolean fields CIL: runtime address defenses preserve the cached readonly reference after restore', () => {
  const vm = new CilVirtualMachine(independentField(), {weakStringInterning: true});
  try {
    const token = vm.top.method.instructions[0].operand;
    const slot = staticSlot(vm, token);
    const value = vm.statics.get(slot.key);
    assert.equal(vm.heap.get(value).data, 'True');
    for (const opcode of ['stsfld', 'ldsflda', 'ldfld']) assert.throws(() => staticSlot(vm, token, vm.top, opcode), /readonly|static access/);
    const saved = vm.snapshot();
    const replacement = vm.heap.string('changed');
    assert.throws(() => vm.dereference(vm.address('static', slot.key), true, replacement), /readonly/);
    assert.equal(vm.statics.get(slot.key), value);
    vm.restore(saved);
    vm.heap.collect();
    assert.equal(vm.statics.get(slot.key), value);
    assert.equal(vm.heap.get(value).data, 'True');
  } finally { vm.stop(); }
});

for (const reference of ['definition', 'definition-member', 'module-member']) {
  test(`Boolean fields CIL: same-named local ${reference} storage remains writable`, () => {
    const bytes = managedFixture({fields: [{name: 'TrueString', type: 'string'}],
      methods: [{name: 'Main', result: 'string', body(writer, context) {
        let field = context.fields.TrueString;
        if (reference !== 'definition') {
          const owner = reference === 'definition-member' ? context.type :
            context.md.add(1, [0, context.md.string('Boolean'), context.md.string('System')]);
          field = context.md.member(owner, 'TrueString', fieldSignature('string', context.resolve));
        }
        writer.op('ldstr', 0x70000000 | context.md.userString('local field')).op('stsfld', field).op('ldsfld', field).op('ret');
      }}], decorate({md}) {
        md.rows[2][1][1] = md.string('Boolean');
        md.rows[2][1][2] = md.string('System');
      }});
    const vm = new CilVirtualMachine(bytes);
    try { assert.equal(vm.run().returnValue, 'local field'); } finally { vm.stop(); }
  });
}

test('Boolean field canonical loader: exact field metadata is required and adjacent instructions cannot become field markers', () => {
  const inspector = new AssemblyInspector(independentField());
  const load = inspector.getMethod(inspector.pe.entryPoint).instructions[0];
  const constants = [];
  const context = {metadata: inspector.metadata, staticByToken: new Map(), fieldByToken: new Map(),
    intern(value) { constants.push(value); return constants.length - 1; }};
  assert(decodeFieldSpan([load], context));
  assert.deepEqual(constants, [{readonlyField: {owner: 'System.Boolean', name: 'TrueString'}}]);
  for (const span of [[load, {name: 'nop'}], [load, load], [{...load, name: 'stsfld'}]]) {
    assert.throws(() => decodeFieldSpan(span, context), /Unknown static field token/);
  }
  assert.equal(constants.length, 1);
});

test('Boolean field canonical loader rejects forged assembly identities even when canonical replay could preserve their bytes', () => {
  const program = compileToIL('class Program { static void Main() { System.Console.WriteLine(bool.TrueString); } }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  const token = Uint8Array.from('b03f5f7f11d50a3a'.match(/../g), pair => parseInt(pair, 16));
  for (const change of [{publicKeyOrToken: new Uint8Array(8)}, {culture: 'en-US'}]) {
    const bytes = emitAssembly(program.image, {assemblyReferences: [
      {name: 'System.Runtime', version: [8, 0, 0, 0], culture: '', flags: 0, publicKeyOrToken: token, ...change}
    ]});
    assert.throws(() => loadAssembly(bytes), /External readonly field has an unapproved assembly identity/);
  }
  const version = [10, 1, 2, 3];
  const bytes = emitAssembly(program.image, {assemblyReferences: [
    {name: 'System.Runtime', version, culture: '', flags: 0, publicKeyOrToken: token}
  ]});
  const inspector = new AssemblyInspector(bytes);
  const field = inspector.types.flatMap(type => type.methods).flatMap(method => inspector.getMethod(method.token).instructions)
    .filter(instruction => instruction.name === 'ldsfld').map(instruction => inspector.resolveToken(instruction.operand))
    .find(member => member.owner === 'System.Boolean');
  const scope = decodeCoded('ResolutionScope', inspector.metadata.row(field.ownerToken)[0]);
  assert.deepEqual(inspector.metadata.row(scope).slice(0, 4), version);
  assert.doesNotThrow(() => loadAssembly(bytes));
});

test('Readonly numeric controls keep their nonallocating static initialization path', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', body(writer, context) {
    writer.op('ldsfld', fieldReference(context, {owner: 'System.Diagnostics.Stopwatch', name: 'Frequency', type: 'long'})).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes);
  try {
    const before = vm.heap.stats.allocations;
    assert.equal(vm.run().returnValue, 1000000000n);
    assert.equal(vm.heap.stats.allocations, before);
    assert.equal(vm.platform.stringInitializations, undefined);
  } finally { vm.stop(); }
});
