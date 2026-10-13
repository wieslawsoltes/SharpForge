import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compile} from '@sharpforge/compiler';
import {frameworkType, findContracts} from '@sharpforge/framework';
import {CilVirtualMachine, VirtualMachine, isReference} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {fieldReference, fieldAssemblyIdentities} from './fixtures/a07/readonly-fields.js';

const owner = 'System.Boolean';
const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('boolean-string-fields-net10.json', directory), 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(new URL(path, directory))).digest('hex');

test('Boolean fields: native capture identifies the frozen .NET 10.0.5 source, project and runtime assembly', () => {
  assert.equal(digest('boolean-string-fields-net10.json'),
    '5155917b117ab8906d00c4863efa0220cd9b0140bd847037418585701dd13d69');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.frameworkDescription, '.NET 10.0.5');
  assert.deepEqual(native.assemblyIdentity, {
    name: 'System.Private.CoreLib', version: '10.0.0.0', culture: '', publicKeyToken: '7cec85d7bea7798e'
  });
  assert.match(native.assemblySha256, /^[0-9a-f]{64}$/);
  assert.equal(native.sourceSha256, digest('boolean-string-fields/Program.cs'));
  assert.equal(native.sourceSha256, '8cc63fdef39f630d63cb50718c68de43b759004c059ceb2dc08503d0dfb14dc0');
  assert.equal(native.projectSha256, digest('boolean-string-fields/BooleanStringFieldsReference.csproj'));
  assert.equal(native.projectSha256, '772eff4e2c0f9b0327bb80d130bf73799ec1f47fb8ff8a7572162535705973d4');
  assert.equal(native.referenceSource,
    'https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Boolean.cs');
  assert.equal(native.metadata.length, 2);
  assert.equal(native.rows.length, 2);
});

test('Boolean fields: registered inventory matches all native public fields without inventing accessors or constants', () => {
  const type = frameworkType(owner);
  assert.deepEqual(native.metadata.map(field => field.name), ['FalseString', 'TrueString']);
  assert.deepEqual(Object.keys(type.fields).sort(), native.metadata.map(field => field.name));
  for (const row of native.metadata) {
    const descriptor = type.fields[row.name];
    assert.equal(row.kind, 'field');
    assert.equal(row.owner, owner);
    assert.equal(row.result, 'System.String');
    assert.equal(row.isPublic, true);
    assert.equal(row.isStatic, true);
    assert.equal(row.readOnly, true);
    assert.equal(row.literal, false);
    assert.equal(row.propertyExists, false);
    assert.equal(row.getterExists, false);
    assert.equal(descriptor.type, 'string');
    assert.equal(descriptor.isStatic, row.isStatic);
    assert.equal(descriptor.readOnly, row.readOnly);
    assert.equal(descriptor.value, native.rows.find(value => value.name === row.name).value);
    assert.equal(type.properties[row.name], undefined);
    assert.deepEqual(findContracts(owner, 'get_' + row.name), []);
  }
});

test('Boolean fields: native value, copy, interning and culture observations remain explicit', () => {
  for (const row of native.rows) {
    assert.equal(row.value, row.name === 'TrueString' ? 'True' : 'False');
    assert.equal(row.length, row.value.length);
    assert.deepEqual(row.codeUnits, row.value.split('').map(character => character.charCodeAt(0)));
    assert.equal(row.copySameReference, false);
    for (const name of ['literalSameReference', 'reflectedSameReference', 'repeatedSameReference',
      'sameReferenceAfterCollection', 'isInternedSameReference', 'copyEqual', 'copyIsInternedSameReference',
      'internCopySameReference']) assert.equal(row[name], true, row.name + ':' + name);
  }
  assert.deepEqual(native.cultures.map(row => row.culture), ['', 'en-US', 'tr-TR', 'az-Latn-AZ']);
  for (const row of native.cultures) {
    assert.equal(row.trueValue, 'True');
    assert.equal(row.falseValue, 'False');
    assert.equal(row.sameTrueReference, true);
    assert.equal(row.sameFalseReference, true);
  }
  assert.deepEqual(native.observations, {
    keywordTrueSameReference: true,
    keywordFalseSameReference: true,
    distinctFieldReferences: true,
    distinctFieldValues: true
  });
});

for (const pipeline of ['bound', 'legacy']) {
  test(`Boolean fields ${pipeline} source: values, lengths and literal identity match the native capture`, () => {
    const statements = native.rows.map(row => `
      Console.WriteLine(Boolean.${row.name});
      Console.WriteLine(bool.${row.name}.Length);
      Console.WriteLine(Object.ReferenceEquals(Boolean.${row.name}, ${JSON.stringify(row.value)}));`);
    const program = compile(`using System; class Program { static void Main() { ${statements.join('\n')} } }`, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = new VirtualMachine(program.image);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, native.rows.flatMap(row => [row.value, row.length,
        row.literalSameReference ? 'True' : 'False']).join('\n') + '\n');
    } finally { vm.stop(); }
  });
}

function readFieldAssembly(row, identity) {
  return managedFixture({
    fields: [{name: 'Value', type: 'string'}, {name: 'LiteralIdentity', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', body(writer, context) {
      const field = fieldReference(context, {owner, name: row.name, type: 'string', identity});
      writer.op('ldsfld', field).op('dup').op('stsfld', context.fields.Value);
      writer.op('ldstr', 0x70000000 | context.md.userString(row.value));
      writer.op('call', context.member('System.Object', 'ReferenceEquals', 'bool', ['object', 'object']));
      writer.op('stsfld', context.fields.LiteralIdentity).op('ret');
    }}]
  });
}

for (const [scope, identity] of Object.entries(fieldAssemblyIdentities)) {
  for (const weakStringInterning of [false, true]) {
    for (const row of native.rows) {
      test(`Boolean field ${row.name}: independent ${scope} CIL with weak interning ${weakStringInterning} matches native`, () => {
        const vm = new CilVirtualMachine(readFieldAssembly(row, identity), {weakStringInterning});
        try {
          const result = vm.run();
          assert.equal(result.state, 'terminated', result.fault?.stack);
          const reference = vm.statics.get(0x04000001);
          assert.equal(isReference(reference), true);
          assert.equal(vm.heap.get(reference).kind, 'string');
          assert.equal(vm.platform.native(reference), row.value);
          assert.equal(vm.platform.native(reference).length, row.length);
          assert.equal(Boolean(vm.statics.get(0x04000002)), row.literalSameReference);
          vm.heap.collect();
          assert.equal(vm.platform.native(reference), row.value);
        } finally { vm.stop(); }
      });
    }
  }
}
