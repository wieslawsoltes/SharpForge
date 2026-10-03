import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T46: C# 11 generic attributes, file-local types, static abstract members and checked operators.
const unitMembers = (text, options) => SyntaxTree.parseText(text, options).root.members;

test('T46 generic attributes, file types, static abstract members and checked operators match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp11-12/csharp11.cs');
  for (const kind of ['AttributeList', 'GenericName', 'OperatorDeclaration', 'ConversionOperatorDeclaration', 'CheckedExpression', 'CheckedStatement'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const files = [...tree.root.descendantTokens()].filter(token => token.text === 'file');
  assert.equal(files.filter(token => token.kind === 'FileKeyword').length, 16);
  assert.equal(files.filter(token => token.kind === 'IdentifierToken').length, 5, '`file` stays an identifier in fields, locals and expressions');
  const checkedOperators = [...tree.root.descendantNodes()].filter(node => /OperatorDeclaration$/.test(node.kind) && node.checkedKeyword);
  assert.equal(checkedOperators.length, 13);
});

test('T46 an attribute name may carry type arguments', () => {
  const [type] = unitMembers('[Attr<int>] [N.Other<string, List<int>>(1)] class C { }');
  assert.equal(shapeOf(type.attributeLists[0].attributes[0].name), 'GenericName(Attr TypeArgumentList(< PredefinedType(int) >))');
  assert.equal(type.attributeLists[1].attributes[0].name.kind, 'QualifiedName');
  assert.equal(type.attributeLists[1].attributes[0].name.right.kind, 'GenericName');
});

test('T46 file is a type modifier, in any position among the modifiers', () => {
  assert.deepEqual(
    unitMembers('file class F { } file record R(int A); public file static class S { } file enum E { A } file delegate void D();').map(member => [
      member.kind,
      member.modifiers.map(modifier => modifier.text).join(' ')
    ]),
    [
      ['ClassDeclaration', 'file'],
      ['RecordDeclaration', 'file'],
      ['ClassDeclaration', 'public file static'],
      ['EnumDeclaration', 'file'],
      ['DelegateDeclaration', 'file']
    ]
  );
});

test('T46 file stays an identifier elsewhere', () => {
  const [type] = unitMembers('class D { int file; void N() { int file = 1; file++; var x = file + 1; file.M(); } }');
  assert.deepEqual(
    type.members.map(member => member.kind),
    ['FieldDeclaration', 'MethodDeclaration']
  );
  assert.deepEqual(diagnosticsOf('class D { int file; void N() { int file = 1; file++; file.M(); } }'), []);
  assert.deepEqual(
    unitMembers('file.M(); file = 1; file x;').map(member => member.statement.kind),
    ['ExpressionStatement', 'ExpressionStatement', 'LocalDeclarationStatement'],
    'a top-level statement may start with an identifier named file'
  );
  assert.equal(unitMembers('class D { file x; }', { languageVersion: '10' })[0].members[0].kind, 'FieldDeclaration', 'before C# 11 `file x;` is a field of type file');
});

test('T46 static abstract and static virtual interface members, including operators', () => {
  const [type] = unitMembers(
    'interface I<T> { static abstract T operator +(T a, T b); static abstract T Zero { get; } static virtual void Log() { } ' +
      'static abstract explicit operator checked int(T a); }'
  );
  assert.deepEqual(
    type.members.map(member => [member.kind, member.modifiers.map(modifier => modifier.text).join(' '), !!member.body]),
    [
      ['OperatorDeclaration', 'static abstract', false],
      ['PropertyDeclaration', 'static abstract', false],
      ['MethodDeclaration', 'static virtual', true],
      ['ConversionOperatorDeclaration', 'static abstract', false]
    ]
  );
  assert.equal(type.members[3].checkedKeyword.kind, 'CheckedKeyword');
});

test('T46 the 11.0 gates fire where Roslyn reports them', () => {
  // A generic class deriving from Attribute is itself gated, which only the binder can know.
  const agreed = assertGatesMatchRoslyn('gates/csharp11.rejected.cs', ['CS8936@135..144']);
  assert.equal(agreed.length, 24);
  assert.deepEqual(diagnosticsOf('[Attr<int>] class C { }', '10'), ['CS8936@1 "Attr<int>"']);
  assert.deepEqual(diagnosticsOf('file class F { }', '10'), ['CS8936@11 "F"']);
  assert.deepEqual(diagnosticsOf('interface I { static abstract void M(); static virtual int P => 1; }', '10'), ['CS8703@35 "M"', 'CS8703@59 "P"']);
  assert.deepEqual(diagnosticsOf('interface I { static void M() { } }', '10'), [], 'a static member with a body is C# 8');
  assert.deepEqual(diagnosticsOf('struct V { public static V operator checked +(V a, V b) => a; }', '10'), ['CS8936@36 "checked"']);
  const all = '[Attr<int>] file class F { } interface I { static abstract void M(); } struct V { public static V operator checked -(V a) => a; }';
  assert.deepEqual(diagnosticsOf(all, '11'), []);
});

test('T46 malformed generic attributes and file declarations recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp11-12/csharp11-recovery.cs');
  assert.equal(tree.root.members[1].attributeLists[0].attributes[0].name.kind, 'GenericName', '`[Attr<int]` keeps its type arguments');
});
