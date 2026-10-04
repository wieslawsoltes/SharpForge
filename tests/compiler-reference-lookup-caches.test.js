import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToAssembly, compileToReferenceAssembly, createReferenceSet } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { NamedTypeSymbol, TypeParameterSymbol, SymbolKind } from '../packages/compiler/src/symbols/types.js';
import { MethodSymbol, FieldSymbol } from '../packages/compiler/src/symbols/members.js';
import { NamespaceSymbol, MergedNamespaceSymbol, NamespaceExtent } from '../packages/compiler/src/symbols/namespaces.js';
import { extensionClassesIn } from '../packages/compiler/src/overload/extension-methods.js';

// SF-A02-T30: the lookups that binding against real reference assemblies makes hot - members of a type by name,
// members of a constructed type, types of a namespace merged from many assemblies, the classes of a namespace that
// declare extensions, and the binding of a reference set - are indexed or remembered. These tests pin that the
// remembered answers stay correct when the underlying symbols change the way they legitimately can.
// Numbers: packages/compiler/bench/reference-binding.bench.js (see the pull request).

const voidType = new NamedTypeSymbol({ name: 'Void' });
const method = name => new MethodSymbol({ name, parameters: [], returnType: voidType });

test('A02-T30 members by name: declaration order, a fresh array, and members added later are found', () => {
  const type = new NamedTypeSymbol({ name: 'Box', members: [method('A'), method('B'), method('A')] });
  const first = type.getMembers('A');
  assert.deepEqual(first.map(member => member.name), ['A', 'A']);
  assert.equal(first[0], type.getMembers()[0]);
  first.length = 0;
  assert.equal(type.getMembers('A').length, 2, 'the caller owns the array it gets');
  assert.deepEqual(type.getMembers('Missing'), []);
  const added = type.addMember(method('A'));
  assert.equal(type.getMembers('A').at(-1), added);
  assert.equal(type.getMembers('B').length, 1);
});

test('A02-T30 members of a constructed type are substituted by name and keep one identity', () => {
  const parameter = new TypeParameterSymbol({ name: 'T', ordinal: 0 }),
    definition = new NamedTypeSymbol({ name: 'Box', typeParameters: [parameter] }),
    int = new NamedTypeSymbol({ name: 'Int32' });
  definition.addMember(new FieldSymbol({ name: 'Value', type: parameter }));
  definition.addMember(method('Clear'));
  const constructed = definition.construct(int),
    byName = constructed.getMembers('Value');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].type, int, 'the field of Box<Int32> has the type argument');
  assert.equal(byName[0].containingType, constructed);
  assert.equal(constructed.getMembers('Value')[0], byName[0], 'the same member on every lookup');
  assert.equal(constructed.getMembers().find(member => member.name === 'Value'), byName[0], 'and in the full list');
  assert.equal(constructed.getMembers().length, 2);
  assert.equal(constructed.getMembers('Clear')[0].kind, SymbolKind.Method);
});

test('A02-T30 a merge of metadata namespaces remembers lookups; a merge with a source namespace does not', () => {
  const metadata = name => {
      const root = new NamespaceSymbol('', null, NamespaceExtent.Metadata);
      root.addType(new NamedTypeSymbol({ name }));
      return root;
    },
    first = metadata('Alpha'),
    second = metadata('Beta'),
    references = new MergedNamespaceSymbol([first, second]);
  assert.equal(references.isImmutable, true);
  assert.deepEqual(references.getTypeMembers('Beta').map(type => type.name), ['Beta']);
  const again = references.getTypeMembers('Beta');
  again.push('changed by the caller');
  assert.equal(references.getTypeMembers('Beta').length, 1);
  assert.deepEqual(references.getTypeMembers('Missing'), []);
  assert.equal(references.getTypeMembers().length, 2);
  const source = new NamespaceSymbol('', null, NamespaceExtent.Source),
    compilation = new MergedNamespaceSymbol([source, references]);
  assert.equal(compilation.isImmutable, false);
  assert.deepEqual(compilation.getTypeMembers('Late'), []);
  source.addType(new NamedTypeSymbol({ name: 'Late' }));
  assert.equal(compilation.getTypeMembers('Late').length, 1, 'a type declared later in source is found');
});

test('A02-T30 the classes that declare extensions: source classes are asked every time', () => {
  const source = new NamespaceSymbol('', null, NamespaceExtent.Source);
  assert.deepEqual(extensionClassesIn(source), []);
  source.addType(new NamedTypeSymbol({ name: 'Extensions', isStatic: true }));
  source.addType(new NamedTypeSymbol({ name: 'Plain' }));
  assert.deepEqual(extensionClassesIn(source).map(type => type.name), ['Extensions']);
});

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';

test('A02-T30 a reference set is bound once and serves different programs with independent results', { skip }, () => {
  const good = 'using System.Linq; class P { static void Main() { System.Console.WriteLine(new[] { 1, 2 }.Sum()); } }',
    bad = 'class P { static void Main() { System.Console.Missing(); } }',
    codes = result => result.diagnostics.filter(entry => entry.severity === 'error' && /^CS/.test(entry.code)).map(entry => entry.code);
  const first = compileToAssembly(good, { name: 'Sample', references: pack.references });
  assert.deepEqual(codes(compile(bad, { references: pack.references })), ['CS0117']);
  const second = compileToAssembly(good, { name: 'Sample', references: pack.references });
  assert.ok(first.assembly && second.assembly);
  assert.deepEqual([...second.assembly], [...first.assembly], 'a failed compilation in between leaves nothing behind');
  // A source type that shadows a framework name in one compilation is not seen by the next one.
  const shadow = 'namespace System.Linq { static class Enumerable { } } class P { static void Main() { } }';
  assert.deepEqual(codes(compile(shadow, { references: pack.references })), []);
  assert.deepEqual([...compileToAssembly(good, { name: 'Sample', references: pack.references }).assembly], [...first.assembly]);
});

test('A02-T30 the classes of an imported namespace that declare extensions are a short list', { skip }, () => {
  const library = compileToReferenceAssembly(
      `namespace Lib { public static class StringExtensions { public static int Twice(this string text) => text.Length * 2; }
         public static class Helpers { public static int Plain(string text) => 1; } public class Widget { } }`,
      { name: 'Lib', references: pack.references },
    ),
    references = createReferenceSet([...pack.references, { bytes: library.assembly, display: 'Lib.dll' }]),
    program = 'using Lib; class P { static int Main() { return "ab".Twice(); } }',
    result = compileToAssembly(program, { name: 'Sample', references });
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`),
    [],
  );
  const lib = references.at(-1).assembly.globalNamespace.getNamespace('Lib');
  assert.deepEqual(extensionClassesIn(lib).map(type => type.name), ['StringExtensions']);
  assert.equal(extensionClassesIn(lib), extensionClassesIn(lib), 'kept on the namespace symbol');
});
