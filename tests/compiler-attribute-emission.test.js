import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute, TypeAttributes } from '@sharpforge/cil';
import { compileToReferenceAssembly } from '@sharpforge/compiler';

// SF-A02-T41 / SF-A02-T29: CustomAttribute rows from bound attributes, read back with the metadata reader.
// The same sample built by Roslyn and loaded with .NET reflection is pinned in
// packages/compiler/test/reference-assembly/attributes.roslyn.txt (compare.mjs: 91 lines agree, 4 pending).

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'compiler', 'test', 'reference-assembly');
const ASSEMBLY = 0x20000001;
/** Enums the reader meets by name only (another assembly's, or the type of a named argument). */
const namedEnums = { 'System.AttributeTargets': 'int', 'Acme.Marks.Level': 'short' };
const externalEnums = name => namedEnums[name];
/** A decoded argument without its type descriptors: the value, arrays element by element. */
function plain(argument) {
  if (Array.isArray(argument)) return argument.map(plain);
  return argument && typeof argument === 'object' && Object.hasOwn(argument, 'value') ? plain(argument.value) : argument;
}

/** The custom attributes of an emitted program as `{parent, type, fixed, named}`, in row order. */
function attributesOf(source, name = 'Attributes') {
  const result = compileToReferenceAssembly(source, { name });
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.message}`), []);
  const inspector = new AssemblyInspector(result.assembly),
    metadata = inspector.metadata;
  const rows = (metadata.rows[12] ?? []).map(([parent, type, value]) => {
    const constructor = decodeCoded('CustomAttributeType', type),
      row = metadata.row(constructor),
      declaring = inspector.types.find(t => t.methods.some(m => m.token === constructor)),
      owner = declaring ? declaring.name : metadata.typeName(decodeCoded('MemberRefParent', row[0])),
      decoded = decodeCustomAttribute(metadata.blob(value), constructor, { metadata, enumUnderlyingType: externalEnums });
    assert.equal(decoded.success, true, `${owner}: ${decoded.diagnostics.map(d => d.message).join('; ')}`);
    return {
      parent: decodeCoded('HasCustomAttribute', parent),
      type: owner,
      fixed: decoded.constructorArguments.map(plain),
      named: Object.fromEntries(decoded.namedArguments.map(argument => [argument.name, plain(argument)])),
    };
  });
  const type = typeName => inspector.types.find(t => t.name === typeName) ?? assert.fail(`no type ${typeName}`),
    on = parent => rows.filter(row => row.parent === parent);
  return { inspector, metadata, rows, type, on };
}
const sample = readFileSync(join(fixtures, 'attributes.cs'), 'utf8');
const NOTE = 'Acme.Marks.NoteAttribute';

test('A02-T41 attributes on types carry their constructor, fixed and named arguments', () => {
  const { type, on } = attributesOf(sample),
    marked = on(type('Acme.Marks.Marked').token);
  assert.deepEqual(marked.map(a => a.type), ['System.Reflection.DefaultMemberAttribute', NOTE, NOTE]);
  assert.deepEqual(marked[0].fixed, ['Item']);
  assert.deepEqual(marked[1].fixed, ['type', 1]);
  assert.deepEqual(marked[1].named, { Detail: 'named', Weight: 7 });
  assert.deepEqual(marked[2].fixed, [2], 'an enum argument is its underlying value');
  assert.ok(type('Acme.Marks.Marked').flags & TypeAttributes.Serializable, '[Serializable] is the TypeDef flag, not a row');
  assert.deepEqual(on(type('Acme.Marks.Options').token).map(a => a.type), ['System.FlagsAttribute']);
  assert.deepEqual(on(type('Acme.Marks.NoteAttribute').token).map(a => [a.type, a.named]), [['System.AttributeUsageAttribute', { AllowMultiple: true }]]);
});

test('A02-T41 attributes on the assembly, members and parameters; typeof, arrays, boxed and null arguments', () => {
  const { type, on } = attributesOf(sample),
    marked = type('Acme.Marks.Marked'),
    member = (list, name) => marked[list].find(m => m.name === name);
  assert.deepEqual(on(ASSEMBLY).map(a => [a.type, a.fixed]), [['System.CLSCompliantAttribute', [false]], [NOTE, ['assembly', 0]]]);
  const field = on(member('fields', 'Field').token);
  assert.deepEqual(field.map(a => a.type), [NOTE, 'System.ObsoleteAttribute']);
  assert.deepEqual(field[0].fixed, ['Acme.Marks.Marked', ['a', 'b']], 'typeof is the type name; expanded params are one array');
  assert.deepEqual(field[1].fixed, ['use Other', false]);
  assert.deepEqual(on(member('properties', 'Text').token)[0].named, { Levels: [1, 2] });
  assert.deepEqual(on(member('methods', '.ctor').token)[0].fixed, ['System.Int32[]', []], 'no params elements: an empty array');
  const event = on(member('events', 'Changed').token);
  assert.deepEqual(event.map(a => a.fixed.length), [1, 1]);
  assert.deepEqual(event.map(a => a.fixed[0]), [42, 'text'], 'a value passed as object keeps its own type');
  assert.deepEqual(on(member('methods', 'Run').token).map(a => a.fixed), [['method', 3]]);
  const compilerGenerated = 'System.Runtime.CompilerServices.CompilerGeneratedAttribute';
  for (const name of ['get_Text', 'set_Text', 'add_Changed', 'remove_Changed']) {
    assert.deepEqual(on(member('methods', name).token).map(a => a.type), [compilerGenerated], name);
  }
  assert.deepEqual(on(member('fields', '<Text>k__BackingField').token).map(a => a.type), [compilerGenerated]);
});

test('A02-T41 parameter attributes: declared, params and indexer parameters repeated on the accessor', () => {
  const { metadata, rows } = attributesOf(sample),
    parameters = rows.filter(row => row.parent >>> 24 === 8).map(row => [metadata.string(metadata.row(row.parent)[2]), row.type, row.fixed]);
  assert.deepEqual(parameters, [
    ['tags', 'System.ParamArrayAttribute', []],
    ['value', NOTE, ['parameter', 4]],
    ['rest', 'System.ParamArrayAttribute', []],
    ['rest', NOTE, [null, 5]],
    ['index', NOTE, ['index', 6]],
  ]);
});

test('A02-T41 an argument metadata cannot express is reported and no image is produced', () => {
  const generic = `using System; using System.Collections.Generic;
    class NoteAttribute : Attribute { public NoteAttribute(Type type) { } }
    [Note(typeof(List<int>))] class C { }`;
  const result = compileToReferenceAssembly(generic);
  assert.equal(result.assembly, null);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code), ['SF3001']);
  assert.match(result.diagnostics.at(-1).message, /typeof\(.*List<int>\) in an attribute argument cannot be written/);
});

test('A02-T41 a program without attributes has no CustomAttribute rows; pseudo-attributes are not rows', () => {
  assert.deepEqual(attributesOf('class C { int f; void M(int x) { f = x; } }', 'Plain').rows, []);
  const { rows } = attributesOf('using System; [Serializable] class C { }', 'Pseudo');
  assert.deepEqual(rows, []);
});
