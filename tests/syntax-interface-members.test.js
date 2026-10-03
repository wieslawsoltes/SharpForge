import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf } from './support/syntax-reference.js';

// SF-A01-T41: C# 8 default interface members, static local functions and readonly members.
const membersOf = text => SyntaxTree.parseText(text).root.members[0].members;

test('T41 interface members with bodies, modifiers, static members and nested types match Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp8/interface-members.cs');
  assert.deepEqual(tree.getDiagnostics(), []);
  const kinds = new Set(tree.root.members[0].members.map(member => member.kind));
  for (const kind of [
    'MethodDeclaration',
    'PropertyDeclaration',
    'FieldDeclaration',
    'ConstructorDeclaration',
    'OperatorDeclaration',
    'ClassDeclaration',
    'StructDeclaration',
    'InterfaceDeclaration',
    'EnumDeclaration',
    'DelegateDeclaration',
    'EventFieldDeclaration',
    'EventDeclaration',
    'IndexerDeclaration'
  ])
    assert(kinds.has(kind), kind);
});

test('T41 an interface member is parsed like a class member', () => {
  const [bodiless, body, expression, modified, field] = membersOf(
    'interface I { void A(); void B() { } int C() => 1; private static void D() { } static int E = 1; }'
  );
  assert.deepEqual([!!bodiless.body, !!body.body, !!expression.expressionBody], [false, true, true]);
  assert.deepEqual(
    modified.modifiers.map(modifier => modifier.text),
    ['private', 'static']
  );
  assert.equal(field.kind, 'FieldDeclaration');
});

test('T41 readonly is accepted on struct members and accessors', () => {
  const [method, property, accessors, field] = membersOf(
    'struct S { public readonly int A() => 1; public readonly int P => 1; public int R { readonly get => 1; set { } } readonly int f; }'
  );
  assert(method.modifiers.some(modifier => modifier.kind === 'ReadOnlyKeyword'));
  assert(property.modifiers.some(modifier => modifier.kind === 'ReadOnlyKeyword'));
  assert.deepEqual(
    accessors.accessorList.accessors.map(accessor => accessor.modifiers.map(modifier => modifier.text).join(' ')),
    ['readonly', '']
  );
  assert.equal(field.kind, 'FieldDeclaration');
});

test('T41 the 8.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp8-members.rejected.cs');
  assert.equal(agreed.filter(entry => entry.startsWith('CS8370')).length, 27);
  assert.equal(agreed.filter(entry => entry.startsWith('CS8703')).length, 11, 'a modifier on a bodiless member has its own diagnostic');
});

test('T41 gates by form', () => {
  assert.deepEqual(diagnosticsOf('interface I { void A(); int P { get; set; } event System.Action E; }', '7.3'), [], 'C# 1 interface members');
  assert.deepEqual(diagnosticsOf('interface I { void B() { } }', '7.3'), ['CS8370@19 "B"']);
  assert.deepEqual(diagnosticsOf('interface I { int Q { get => 1; } }', '7.3'), ['CS8370@22 "get"']);
  assert.deepEqual(diagnosticsOf('interface I { public void D(); }', '7.3'), ['CS8703@26 "D"']);
  assert.deepEqual(diagnosticsOf('interface I { class N { void M() { } } }', '7.3'), ['CS8370@20 "N"'], 'members of a nested class are class members');
  assert.deepEqual(diagnosticsOf('struct S { public readonly int A() => 1; }', '7.3'), ['CS8370@18 "readonly"']);
  assert.deepEqual(diagnosticsOf('struct S { public int R { readonly get => 1; set { } } }', '7.3'), ['CS8370@26 "readonly"']);
  assert.deepEqual(diagnosticsOf('struct S { readonly int f; public static readonly int g = 1; }', '1'), [], 'readonly fields are C# 1');
  assert.deepEqual(diagnosticsOf('class C { void M() { static int A(int x) => x; } }', '7.3'), ['CS8370@21 "static"']);
  const all = 'interface I { void B() { } public void D(); static int L = 1; class N { } } struct S { public readonly int A() => 1; }';
  assert.deepEqual(diagnosticsOf(all, '8'), []);
});

test('T41 incomplete members recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp8/interface-members-recovery.cs');
  const codes = tree.getDiagnostics().map(diagnostic => diagnostic.code);
  assert(codes.includes('CS1585'), 'a modifier after a member type reports CS1585');
  assert(codes.includes('CS8180'), 'an accessor without a body or semicolon reports CS8180');
});
