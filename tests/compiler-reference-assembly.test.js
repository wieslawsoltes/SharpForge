import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyInspector, decodeCoded, TypeAttributes, FieldAttributes, MethodAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { compileToReferenceAssembly } from '@sharpforge/compiler';

// SF-A02-T29: metadata tables from source symbols. The emitted image is read back with the metadata reader of
// @sharpforge/cil. The same program built by Roslyn and loaded with .NET reflection is the reference:
// packages/compiler/test/reference-assembly/shapes.roslyn.txt (see compare.mjs there).

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'compiler', 'test', 'reference-assembly');
const shapes = readFileSync(join(fixtures, 'shapes.cs'), 'utf8');

function emit(source, options = { name: 'Shapes' }) {
  const result = compileToReferenceAssembly(source, options);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.message}`), []);
  assert.ok(result.assembly instanceof Uint8Array);
  const inspector = new AssemblyInspector(result.assembly),
    metadata = inspector.metadata,
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`),
    member = (owner, list, name) => type(owner)[list].find(candidate => candidate.name === name) ?? assert.fail(`no ${name} in ${owner}`);
  return { inspector, metadata, type, method: (owner, name) => member(owner, 'methods', name), field: (owner, name) => member(owner, 'fields', name) };
}
const has = (flags, mask) => (flags & mask) === mask;

test('A02-T29 every source type is a TypeDef with its namespace, flags and base type', () => {
  const { inspector, metadata, type } = emit(shapes);
  assert.deepEqual(
    inspector.types.map(t => t.name),
    ['<Module>', 'IShape', 'Shape', 'Shape+Nested`1', 'Circle', 'Point', 'Empty', 'Color', 'Access', 'Transform', 'Box`1', 'Program'].map(name =>
      name === '<Module>' ? name : 'Acme.Shapes.' + name,
    ),
  );
  const base = name => (type(name).baseToken ? metadata.typeName(type(name).baseToken) : null);
  assert.equal(base('Acme.Shapes.IShape'), null);
  assert.equal(base('Acme.Shapes.Shape'), 'System.Object');
  assert.equal(base('Acme.Shapes.Circle'), 'Acme.Shapes.Shape');
  assert.equal(base('Acme.Shapes.Point'), 'System.ValueType');
  assert.equal(base('Acme.Shapes.Color'), 'System.Enum');
  assert.equal(base('Acme.Shapes.Transform'), 'System.MulticastDelegate');
  const flags = name => type(name).flags,
    { Public, Interface, Abstract, Sealed, SequentialLayout, BeforeFieldInit, NestedAssembly } = TypeAttributes;
  assert.equal(flags('Acme.Shapes.IShape'), Public | Interface | Abstract | BeforeFieldInit);
  assert.equal(flags('Acme.Shapes.Shape'), Public | Abstract, 'a static constructor removes BeforeFieldInit');
  assert.equal(flags('Acme.Shapes.Circle'), Public | Sealed | BeforeFieldInit);
  assert.equal(flags('Acme.Shapes.Point'), Public | Sealed | SequentialLayout | BeforeFieldInit);
  assert.equal(flags('Acme.Shapes.Color'), Public | Sealed);
  assert.equal(flags('Acme.Shapes.Program'), Abstract | Sealed | BeforeFieldInit, 'a static class is abstract and sealed');
  assert.equal(flags('Acme.Shapes.Shape+Nested`1'), NestedAssembly | BeforeFieldInit);
  // NestedClass: Nested`1 (row 4) is enclosed by Shape (row 3); an empty struct has ClassLayout size 1.
  assert.deepEqual(metadata.rows[41], [[4, 3]]);
  assert.deepEqual(metadata.rows[15], [[0, 1, 7]]);
});

test('A02-T29 interfaces, explicit implementations and virtual slots are written as the CLR needs them', () => {
  const { metadata, type, method } = emit(shapes);
  const interfaces = name => type(name).interfaces.map(i => metadata.typeName(i.token ?? i)).sort();
  assert.deepEqual(interfaces('Acme.Shapes.Shape'), ['Acme.Shapes.IShape', 'System.IDisposable']);
  assert.deepEqual(interfaces('Acme.Shapes.Circle'), ['System.IComparable`1<Acme.Shapes.Circle>']);
  const { Public, Private, Virtual, Final, NewSlot, Abstract, HideBySig, SpecialName, Static, RTSpecialName, Family } = MethodAttributes;
  assert.equal(method('Acme.Shapes.IShape', 'Scale').flags, Public | Virtual | NewSlot | Abstract | HideBySig);
  assert.equal(method('Acme.Shapes.Shape', 'Scale').flags, Public | Virtual | NewSlot | HideBySig);
  assert.equal(method('Acme.Shapes.Circle', 'Scale').flags, Public | Virtual | Final | HideBySig, 'a sealed override reuses the slot');
  const implementation = Public | Virtual | Final | NewSlot | HideBySig;
  assert.equal(method('Acme.Shapes.Shape', 'Dispose').flags, implementation, 'an implicit implementation is virtual and sealed');
  assert.equal(method('Acme.Shapes.Shape', 'add_Resized').flags, Public | Virtual | Final | NewSlot | HideBySig | SpecialName);
  assert.equal(method('Acme.Shapes.Shape', 'get_Area').flags, Public | Virtual | NewSlot | Abstract | HideBySig | SpecialName);
  assert.equal(method('Acme.Shapes.Shape', '.ctor').flags, Family | HideBySig | SpecialName | RTSpecialName);
  assert.equal(method('Acme.Shapes.Shape', '.cctor').flags, Private | Static | HideBySig | SpecialName | RTSpecialName);
  assert.equal(method('Acme.Shapes.Shape', 'op_Addition').flags, Public | Static | HideBySig | SpecialName);
  const explicit = method('Acme.Shapes.Box`1', 'System.Collections.IEnumerable.GetEnumerator');
  assert.equal(explicit.flags, Private | Virtual | Final | NewSlot | HideBySig);
  // MethodImpl: the explicit implementation fills the slot of IEnumerable.GetEnumerator, a MemberRef.
  assert.equal(metadata.rows[25].length, 1);
  const [owner, body, declaration] = metadata.rows[25][0];
  assert.equal(owner, type('Acme.Shapes.Box`1').token & 0xffffff);
  assert.equal(decodeCoded('MethodDefOrRef', body), explicit.token);
  const reference = metadata.row(decodeCoded('MethodDefOrRef', declaration));
  assert.equal(metadata.string(reference[1]), 'GetEnumerator');
  assert.equal(metadata.typeName(decodeCoded('MemberRefParent', reference[0])), 'System.Collections.IEnumerable');
});

test('A02-T29 abstract and runtime methods have no body; every other method shares the throw-null body', () => {
  const { method, type } = emit(shapes);
  assert.equal(method('Acme.Shapes.IShape', 'Scale').rva, 0);
  assert.equal(method('Acme.Shapes.Shape', 'get_Area').rva, 0);
  const invoke = method('Acme.Shapes.Transform', 'Invoke');
  assert.equal(invoke.rva, 0);
  assert.equal(invoke.implFlags, MethodImplAttributes.Runtime);
  assert.deepEqual(type('Acme.Shapes.Transform').methods.map(m => m.name), ['.ctor', 'Invoke', 'BeginInvoke', 'EndInvoke']);
  const bodies = new Set(['Scale', 'Dispose', '.ctor', 'Pick', 'get_Name'].map(name => method('Acme.Shapes.Shape', name).rva));
  assert.equal(bodies.size, 1);
  assert.ok(!bodies.has(0));
});

test('A02-T29 fields, constants and enum members', () => {
  const { metadata, type, field } = emit(shapes);
  const { Public, Private, Static, Literal, HasDefault, InitOnly, FamORAssem, SpecialName, RTSpecialName } = FieldAttributes;
  assert.deepEqual(type('Acme.Shapes.Shape').fields.map(f => f.name), ['Sides', 'Label', 'tag', 'count', 'Resized', '<Name>k__BackingField']);
  assert.equal(field('Acme.Shapes.Shape', 'Sides').flags, Public | Static | Literal | HasDefault);
  assert.equal(field('Acme.Shapes.Shape', 'tag').flags, Private | Static | InitOnly);
  assert.equal(field('Acme.Shapes.Shape', 'count').flags, FamORAssem);
  assert.equal(field('Acme.Shapes.Shape', '<Name>k__BackingField').flags, Private);
  assert.equal(field('Acme.Shapes.Color', 'value__').flags, Public | SpecialName | RTSpecialName);
  assert.deepEqual(type('Acme.Shapes.Color').fields.map(f => f.name), ['value__', 'Red', 'Green', 'Both']);
  // Constant rows: [element type, HasConstant parent, value blob]; Color is a byte enum, Sides an int, Label a string.
  const constants = new Map(metadata.rows[11].map(([kind, parent, blob]) => [decodeCoded('HasConstant', parent), [kind, [...metadata.blob(blob)]]]));
  assert.deepEqual(constants.get(field('Acme.Shapes.Color', 'Both').token), [5, [3]]);
  assert.deepEqual(constants.get(field('Acme.Shapes.Shape', 'Sides').token), [8, [3, 0, 0, 0]]);
  assert.deepEqual(constants.get(field('Acme.Shapes.Shape', 'Label').token), [14, [...Buffer.from('shape', 'utf16le')]]);
  assert.deepEqual(constants.get(field('Acme.Shapes.Access', 'Write').token), [8, [2, 0, 0, 0]]);
});

test('A02-T29 properties, indexers and events refer to their accessors', () => {
  const { metadata, type, method } = emit(shapes);
  assert.deepEqual(type('Acme.Shapes.Shape').properties.map(p => p.name), ['Area', 'Name', 'Item']);
  assert.deepEqual(type('Acme.Shapes.Shape').events.map(e => e.name), ['Resized']);
  const semantics = metadata.rows[24].map(([kind, methodRow, association]) => [kind, methodRow, decodeCoded('HasSemantics', association)]),
    item = type('Acme.Shapes.Shape').properties.find(p => p.name === 'Item'),
    accessors = semantics.filter(row => row[2] === item.token).map(([kind, methodRow]) => [kind, methodRow]);
  assert.deepEqual(accessors.sort(), [
    [1, method('Acme.Shapes.Shape', 'set_Item').token & 0xffffff],
    [2, method('Acme.Shapes.Shape', 'get_Item').token & 0xffffff],
  ]);
  const resized = type('Acme.Shapes.IShape').events[0];
  assert.deepEqual(semantics.filter(row => row[2] === resized.token).map(row => row[0]).sort((a, b) => a - b), [8, 16]);
});

test('A02-T29 generic parameters carry their number, flags, owner and constraints', () => {
  const { metadata, type, method } = emit(shapes);
  const parameters = metadata.rows[42].map(([number, flags, owner, name], index) => ({
    row: index + 1,
    number,
    flags,
    owner: decodeCoded('TypeOrMethodDef', owner),
    name: metadata.string(name),
  }));
  const constraintsOf = parameter =>
    metadata.rows[44].filter(([owner]) => owner === parameter.row).map(([, constraint]) => metadata.typeName(decodeCoded('TypeDefOrRef', constraint)));
  const of = owner => parameters.filter(parameter => parameter.owner === owner);
  const [nested] = of(type('Acme.Shapes.Shape+Nested`1').token),
    [box] = of(type('Acme.Shapes.Box`1').token),
    [pick] = of(method('Acme.Shapes.Shape', 'Pick').token);
  assert.deepEqual([nested.name, nested.number, nested.flags, constraintsOf(nested)], ['U', 0, 8 | 16, ['System.ValueType']]);
  assert.deepEqual([box.name, box.flags, constraintsOf(box)], ['T', 0, ['System.IComparable`1<!0>']]);
  assert.deepEqual([pick.name, pick.flags, constraintsOf(pick)], ['T', 4 | 16, ['Acme.Shapes.IShape']]);
});

test('A02-T29 a program with errors, or a type metadata cannot express, produces diagnostics and no image', () => {
  const invalid = compileToReferenceAssembly('class C { void M() { int x = "text"; } }');
  assert.equal(invalid.success, false);
  assert.equal(invalid.assembly, null);
  assert.deepEqual(invalid.diagnostics.filter(d => d.severity === 'error').map(d => d.code), ['CS0029']);
  const syntax = compileToReferenceAssembly('class C { void M( { } }');
  assert.equal(syntax.assembly, null);
  assert.ok(syntax.diagnostics.some(d => d.severity === 'error' && /^CS/.test(d.code)));
});

test('A02-T29 emission is deterministic and an empty compilation is a valid image', () => {
  const first = compileToReferenceAssembly(shapes, { name: 'Shapes' }).assembly,
    second = compileToReferenceAssembly(shapes, { name: 'Shapes' }).assembly;
  assert.deepEqual(first, second);
  const { inspector } = emit('', { name: 'Empty' });
  assert.deepEqual(inspector.types.map(t => t.name), ['<Module>']);
});
