import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: `dynamic` in declarations of a directly emitted assembly - `object` in signatures plus `[Dynamic]`
// with its transform flags. Reference for the behaviour: the fixture `reference-fixtures/dynamic-declarations` of
// packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn build prints, the flags read back with
// reflection included (verify-dotnet.mjs --references, SDK 10.0.201, reference pack 10.0.5).

const DYNAMIC = 'System.Runtime.CompilerServices.DynamicAttribute';
const OBJECT = 0x1c;
const SZARRAY = 0x1d;

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  return new AssemblyInspector(result.assembly);
}

/** The `[Dynamic]` rows of an image as `[parent table, flags]`; `flags` is null for the attribute without arguments. */
function dynamicRows(inspector) {
  const metadata = inspector.metadata,
    rows = [];
  for (const [parent, type, value] of metadata.rows[12] ?? []) {
    const constructor = decodeCoded('CustomAttributeType', type),
      owner = decodeCoded('MemberRefParent', metadata.row(constructor)[0]);
    if (metadata.typeName(owner) !== DYNAMIC) continue;
    const decoded = decodeCustomAttribute(metadata.blob(value), constructor, { metadata });
    assert.equal(decoded.success, true);
    const flags = decoded.constructorArguments[0]?.value.map(entry => (entry && typeof entry === 'object' ? entry.value : entry)) ?? null;
    rows.push([decodeCoded('HasCustomAttribute', parent) >>> 24, flags]);
  }
  return rows;
}
const FIELD = 4,
  PARAM = 8,
  PROPERTY = 23;

test('A02-T30 dynamic is object in field, method and local signatures', () => {
  const inspector = emit(`class C {
      public dynamic Value; public dynamic[] Items;
      public static dynamic Pick(dynamic a) { dynamic local = a; return local; }
      static void Main() { System.Console.WriteLine((object)Pick(1)); }
    }`);
  const metadata = inspector.metadata,
    signatures = new Map(metadata.rows[4].map(row => [metadata.string(row[1]), [...metadata.blob(row[2])]]));
  assert.deepEqual(signatures.get('Value'), [0x06, OBJECT]);
  assert.deepEqual(signatures.get('Items'), [0x06, SZARRAY, OBJECT]);
  const pick = metadata.rows[6].find(row => metadata.string(row[3]) === 'Pick');
  assert.deepEqual([...metadata.blob(pick[4])], [0x00, 0x01, OBJECT, OBJECT]);
});

test('A02-T30 [Dynamic] is written on fields, parameters, returns and properties, with transform flags', () => {
  const inspector = emit(`using System.Collections.Generic;
    class C {
      public dynamic Plain;
      public Dictionary<string, dynamic> Map;
      public object NotDynamic;
      public dynamic Property { get; set; }
      public dynamic[] Method(ref dynamic byReference, int number) { return null; }
      static void Main() { }
    }`);
  const rows = dynamicRows(inspector),
    of = table => rows.filter(row => row[0] === table).map(row => row[1]);
  // `Plain`, `Map` and the backing field of `Property`.
  assert.deepEqual(of(FIELD), [null, [false, false, true], null]);
  assert.deepEqual(of(PROPERTY), [null]);
  // The getter's return, the setter's value, and Method's return and `ref dynamic` parameter.
  assert.deepEqual(
    of(PARAM)
      .map(flags => JSON.stringify(flags))
      .sort(),
    ['[false,true]', '[false,true]', 'null', 'null'],
  );
});

test('A02-T30 a program without dynamic references no DynamicAttribute', () => {
  const inspector = emit('class C { public object Value; static void Main() { } }');
  assert.deepEqual(dynamicRows(inspector), []);
  assert.ok(!inspector.summary().references.some(reference => reference.name === 'System.Linq.Expressions'));
});

test('A02-T30 DynamicAttribute is referenced through System.Linq.Expressions, which defines it', () => {
  const inspector = emit('class C { public dynamic Value; static void Main() { } }'),
    metadata = inspector.metadata,
    row = (metadata.rows[1] ?? []).find(entry => metadata.string(entry[1]) === 'DynamicAttribute');
  assert.ok(row, 'a TypeRef for DynamicAttribute');
  const scope = decodeCoded('ResolutionScope', row[0]);
  assert.equal(metadata.string(metadata.row(scope)[6]), 'System.Linq.Expressions');
});

test('A02-T30 dynamic operations without referenced binder members report CS0656, never a wrong assembly', () => {
  for (const body of ['dynamic d = "x"; System.Console.WriteLine(d.Length);', 'dynamic d = 1; d = d + 1;', 'dynamic d = 1; int i = d;']) {
    const result = compileToAssembly(`class C { static void Main() { ${body} } }`, { name: 'Sample' });
    assert.equal(result.assembly, null, body);
    assert.deepEqual(
      result.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code),
      ['CS0656'],
      body,
    );
  }
});
