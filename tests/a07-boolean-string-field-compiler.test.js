import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL, compileToAssembly} from '@sharpforge/compiler';
import {createRegistry} from '@sharpforge/framework';
import {AssemblyInspector, decodeCoded, loadAssembly, emitAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {SymbolKind} from '../packages/compiler/src/symbols/types.js';
import {registeredFieldSymbolValue} from '../packages/compiler/src/symbols/registry-fields.js';
import {booleanFieldNames, fieldMarker} from './fixtures/a07/boolean-string-fields.js';

function fieldsOf(assembly) {
  const inspector = new AssemblyInspector(assembly);
  const fields = inspector.types.flatMap(type => type.methods).flatMap(method => inspector.getMethod(method.token).instructions)
    .filter(instruction => instruction.name === 'ldsfld').map(instruction => inspector.resolveToken(instruction.operand))
    .filter(field => field.owner === 'System.Boolean');
  return {inspector, fields};
}

function assertFieldScopes(assembly) {
  const {inspector, fields} = fieldsOf(assembly);
  assert.deepEqual([...new Set(fields.map(field => field.name))].sort(), [...booleanFieldNames].sort());
  for (const field of fields) {
    assert.equal(field.token >>> 24, 10);
    assert.equal(field.ownerToken >>> 24, 1);
    assert.equal(field.signature.kind, 'field');
    assert.equal(field.signature.type, 'string');
    const scope = decodeCoded('ResolutionScope', inspector.metadata.row(field.ownerToken)[0]);
    assert.equal(scope >>> 24, 35);
    assert.equal(inspector.metadata.string(inspector.metadata.row(scope)[6]), 'System.Runtime');
  }
}

test('Boolean field symbols remain readonly primitive-struct members with no constant or accessor identity', () => {
  const bridge = new RegistryBridge();
  const owner = bridge.typeFromName('bool');
  assert.equal(owner, bridge.typeFromName('System.Boolean'));
  for (const name of booleanFieldNames) {
    const [field] = owner.getMembers(name);
    assert.equal(field.kind, SymbolKind.Field);
    assert.equal(field.containingType, owner);
    assert.equal(field.type, bridge.typeFromName('string'));
    assert.equal(field.isStatic, true);
    assert.equal(field.isReadOnly, true);
    assert.equal(field.isConst, false);
    assert.equal(field.hasConstantValue, false);
    assert.equal(field.constantValue, undefined);
    assert.deepEqual(registeredFieldSymbolValue(field), fieldMarker(name));
    assert.deepEqual(owner.getMembers('get_' + name), []);
  }
});

test('Readonly string symbol lowering retains canonical registry provenance for dotted nested registry names', () => {
  const registry = createRegistry();
  registry.define('Fixture.Outer');
  registry.define('Fixture.Outer.Inner', {fields: {Text: {type: 'string', isStatic: true, readOnly: true, value: 'nested'}}});
  const bridge = new RegistryBridge({types: registry.types, contracts: [], builtins: []});
  const [field] = bridge.typeFromName('Fixture.Outer.Inner').getMembers('Text');
  assert.equal(field.containingType.metadataFullName, 'Fixture.Outer+Inner');
  assert.deepEqual(registeredFieldSymbolValue(field), {readonlyField: {owner: 'Fixture.Outer.Inner', name: 'Text'}});
  assert.deepEqual(registeredFieldSymbolValue({originalDefinition: field, name: 'Text'}),
    {readonlyField: {owner: 'Fixture.Outer.Inner', name: 'Text'}});
});

const source = `using System; class Program {
  static string Saved = Boolean.TrueString;
  static void Main() {
    Console.WriteLine(Saved);
    Console.WriteLine(bool.FalseString);
    Console.WriteLine(object.ReferenceEquals(Saved, Boolean.TrueString));
    Console.WriteLine(object.ReferenceEquals(Boolean.FalseString, "False"));
  }
}`;

for (const pipeline of ['bound', 'legacy']) {
  test(`Boolean fields ${pipeline}: source, canonical reload and CIL preserve genuine field provenance and static initialization`, () => {
    const program = compileToIL(source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const markers = program.image.constants.filter(value => value?.readonlyField);
    assert.deepEqual(markers.map(value => value.readonlyField.name).sort(), [...booleanFieldNames].sort());
    assert(program.image.statics.every(slot => slot.value === null || !slot.value?.readonlyField));
    assertFieldScopes(program.assembly);
    const reloaded = loadAssembly(program.assembly);
    assert.deepEqual(reloaded.constants.filter(value => value?.readonlyField), markers);
    // compileToIL appends Portable PDB data; compare the same canonical PE form.
    assert.deepEqual(emitAssembly(reloaded), emitAssembly(program.image));
    for (const vm of [new VirtualMachine(program.image, {weakStringInterning: true}),
      new VirtualMachine(reloaded, {weakStringInterning: true}), new CilVirtualMachine(program.assembly, {weakStringInterning: true})]) {
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nFalse\nTrue\nTrue\n');
      } finally { vm.stop(); }
    }
  });

  for (const [statement, code] of [
    ['bool.TrueString = "changed";', 'CS0198'],
    ['System.Boolean.FalseString += "changed";', 'CS0198'],
    ['const string value = bool.TrueString;', 'CS0133'],
    ['ref string value = ref bool.TrueString;', 'CS0199']
  ]) {
    test(`Boolean fields ${pipeline}: field reads keep the ${code} language restriction`, () => {
      const program = compile(`class Program { static void Main() { ${statement} } }`, {pipeline});
      assert.equal(program.success, false);
      assert(program.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(program.diagnostics));
    });
  }

  test(`Boolean fields ${pipeline}: a same-named source class retains its mutable storage`, () => {
    const program = compile(`namespace System { class Boolean { public static string TrueString = "local"; } }
      class Program { static void Main() { System.Boolean.TrueString = "changed";
        System.Console.WriteLine(System.Boolean.TrueString); } }`, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    assert.equal(program.image.constants.some(value => value?.readonlyField), false);
    const vm = new VirtualMachine(program.image);
    try { assert.equal(vm.run().output, 'changed\n'); } finally { vm.stop(); }
  });

  test(`Boolean fields ${pipeline}: locals and parameters shadow the Boolean alias`, () => {
    const program = compile(`using System; class Holder { public string TrueString = "local"; }
      class Program {
        static string Read(Holder Boolean) { Boolean.TrueString = "parameter"; return Boolean.TrueString; }
        static void Main() { Holder Boolean = new Holder(); Console.WriteLine(Boolean.TrueString);
          Console.WriteLine(Read(Boolean)); Boolean.TrueString = "local write"; Console.WriteLine(Boolean.TrueString); }
      }`, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    assert.equal(program.image.constants.some(value => value?.readonlyField), false);
    const vm = new VirtualMachine(program.image);
    try { assert.equal(vm.run().output, 'local\nparameter\nlocal write\n'); } finally { vm.stop(); }
  });

  test(`Boolean fields ${pipeline}: escaped identifiers do not acquire predefined-type meaning`, () => {
    const missing = compile('class Program { static void Main() { System.Console.WriteLine(@bool.TrueString); } }', {pipeline});
    assert.equal(missing.success, false);
    assert(missing.diagnostics.some(diagnostic => diagnostic.code === 'CS0103'), JSON.stringify(missing.diagnostics));
    const program = compile(`class Holder { public string TrueString = "escaped"; }
      class Program { static void Main() { Holder @bool = new Holder();
        System.Console.WriteLine(@bool.TrueString); System.Console.WriteLine(bool.TrueString); } }`, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = new VirtualMachine(program.image);
    try { assert.equal(vm.run().output, 'escaped\nTrue\n'); } finally { vm.stop(); }
  });
}

test('Boolean fields: the full semantic CIL compiler emits genuine field references and executes their values', () => {
  const program = compileToAssembly(`class Program { static int Main() {
    return bool.TrueString == "True" && System.Boolean.FalseString == "False" ? 42 : 0;
  } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  assertFieldScopes(program.assembly);
  const vm = new CilVirtualMachine(program.assembly, {weakStringInterning: true});
  try { assert.equal(vm.run().returnValue, 42); } finally { vm.stop(); }
});
