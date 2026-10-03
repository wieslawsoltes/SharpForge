import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, diagnosticsOf } from './support/syntax-reference.js';

// SF-A01-T36: C# 7.2 readonly struct, ref struct and private protected.
const modifiersOf = node => node.modifiers.map(modifier => modifier.text).join(' ');

test('T36 readonly struct, ref struct and private protected match Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp7/struct-modifiers.cs');
  assert.deepEqual(tree.getDiagnostics(), []);
  assert.deepEqual(
    tree.root.members.slice(0, 11).map(member => [member.kind, modifiersOf(member)]),
    [
      ['StructDeclaration', 'readonly'],
      ['StructDeclaration', 'ref'],
      ['StructDeclaration', 'readonly ref'],
      ['StructDeclaration', 'public readonly'],
      ['StructDeclaration', 'public ref'],
      ['StructDeclaration', 'public readonly ref'],
      ['StructDeclaration', 'readonly partial'],
      ['StructDeclaration', 'ref partial'],
      ['StructDeclaration', 'readonly ref partial'],
      ['StructDeclaration', 'public readonly ref partial'],
      ['StructDeclaration', 'unsafe readonly ref']
    ]
  );
});

test('T36 private protected is two modifiers in either order on any member kind', () => {
  const members = classMembersOf(
    'private protected int a; protected private int b; private protected void M() { } private protected class N { } ' +
      'public int P { get; private protected set; } private protected event System.Action E;'
  );
  assert.deepEqual(
    members.map(member => [member.kind, modifiersOf(member)]),
    [
      ['FieldDeclaration', 'private protected'],
      ['FieldDeclaration', 'protected private'],
      ['MethodDeclaration', 'private protected'],
      ['ClassDeclaration', 'private protected'],
      ['PropertyDeclaration', 'public'],
      ['EventFieldDeclaration', 'private protected']
    ]
  );
  assert.equal(modifiersOf(members[4].accessorList.accessors[1]), 'private protected');
});

test('T36 ref before a member type is a ref return, not a struct modifier', () => {
  const [method, nested] = classMembersOf('ref int M() => ref x; ref struct S { }');
  assert.equal(method.kind, 'MethodDeclaration');
  assert.equal(method.returnType.kind, 'RefType');
  assert.equal(modifiersOf(method), '');
  assert.equal(nested.kind, 'StructDeclaration');
  assert.equal(modifiersOf(nested), 'ref');
});

test('T36 each form is rejected at C# 7.1 and accepted at 7.2', () => {
  assert.deepEqual(diagnosticsOf('readonly struct A { }', '7.1'), ['CS8302@0 "readonly"']);
  assert.deepEqual(diagnosticsOf('ref struct B { }', '7.1'), ['CS8302@0 "ref"']);
  assert.deepEqual(diagnosticsOf('public readonly ref struct B { }', '7.1'), ['CS8302@7 "readonly"', 'CS8302@16 "ref"']);
  assert.deepEqual(diagnosticsOf('class N { private protected int a; }', '7.1'), ['CS8302@32 "a"']);
  assert.deepEqual(diagnosticsOf('class N { protected private int a; }', '7.1'), ['CS8302@32 "a"']);
  const all = 'readonly struct A { } ref struct B { } readonly ref struct C { } class N { private protected int a; protected private int b; }';
  assert.deepEqual(diagnosticsOf(all, '7.2'), []);
  assert.deepEqual(diagnosticsOf('class N { protected internal int a; struct S { } }', '1'), [], 'the C# 1 forms need nothing');
});

test('T36 a struct without a name or a body recovers as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp7/struct-modifiers-recovery.cs');
  const structs = [...tree.root.descendantNodes()].filter(node => node.kind === 'StructDeclaration');
  assert.equal(structs.length, 4);
  assert(structs[1].openBraceToken.isMissing && structs[1].closeBraceToken.isMissing, 'a missing { means a missing } and no members');
  const unterminated = SyntaxTree.parseText('ref struct S\nclass C { }');
  assert.deepEqual(
    unterminated.root.members.map(member => member.kind),
    ['StructDeclaration', 'ClassDeclaration'],
    'the next declaration is not swallowed as a member'
  );
});
