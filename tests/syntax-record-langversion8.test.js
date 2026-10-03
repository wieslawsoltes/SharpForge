import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: at LangVersion 8 and below `record` is an identifier, and the tree and
// the parser's diagnostics must be the ones Roslyn produces, so that the binder's diagnostics line up.
const unitMembers = (text, languageVersion) => SyntaxTree.parseText(text, { languageVersion }).root.members;
const parserCodes = (text, languageVersion) =>
  diagnosticsOf(text, languageVersion)
    .map(entry => entry.split(' ')[0])
    .filter(entry => !/^CS8400@/.test(entry));

test('record declarations at LangVersion 8 parse to the tree and diagnostics Roslyn produces', () => {
  const { tree } = assertMatchesRoslyn('reference/versioned/records-langversion8-top-level.cs');
  assert.deepEqual(
    tree.root.members.map(member => member.statement?.kind ?? member.kind),
    [
      'LocalFunctionStatement',
      'PropertyDeclaration',
      'LocalFunctionStatement',
      'ClassDeclaration',
      'LocalDeclarationStatement',
      'StructDeclaration',
      'LocalDeclarationStatement',
      'ClassDeclaration'
    ]
  );
  assert(![...tree.root.descendantNodes()].some(node => /^Record/.test(node.kind)));
});

test('`record R(int X);` is a function returning a type named record; `record S { }` a property of that type', () => {
  const [positional, braces] = unitMembers('record R(int X);\nrecord S { }\n', '8');
  assert.equal(
    shapeOf(positional),
    'GlobalStatement(LocalFunctionStatement(IdentifierName(record) R ParameterList(( Parameter(PredefinedType(int) X) )) ;))'
  );
  assert.equal(shapeOf(braces), 'PropertyDeclaration(IdentifierName(record) S AccessorList({ }))');
  assert.deepEqual(parserCodes('record R(int X);\nrecord S { }\n', '8'), []);
  assert.deepEqual(
    unitMembers('record R(int X);\nrecord S { }\n', '9').map(member => member.kind),
    ['RecordDeclaration', 'RecordDeclaration']
  );
});

test('`record struct S` and `record class C` are a declaration without a name followed by the type', () => {
  const members = unitMembers('record struct W(int A);\nrecord class Q { }\n', '8');
  assert.equal(
    shapeOf(members[0]),
    'GlobalStatement(LocalDeclarationStatement(VariableDeclaration(IdentifierName(record) VariableDeclarator(<IdentifierToken>)) <SemicolonToken>))'
  );
  assert.deepEqual(
    members.map(member => member.kind),
    ['GlobalStatement', 'StructDeclaration', 'GlobalStatement', 'ClassDeclaration']
  );
  assert.deepEqual(parserCodes('record struct W(int A);\n', '8'), ['CS1001@7', 'CS1002@7']);
  assert.deepEqual(parserCodes('record struct W(int A);\nrecord class Q { }\n', '8').slice(2), ['CS8803@24', 'CS1001@31', 'CS1002@31']);
});

test('a top-level function with member modifiers is a local function and reports CS0106, as in Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp9-10/top-level-declarations.cs');
  const functions = [...tree.root.descendantNodes()].filter(node => node.kind === 'LocalFunctionStatement');
  assert.deepEqual(
    functions.map(node => node.modifiers.map(modifier => modifier.text).join(' ')),
    ['public', 'private static']
  );
  assert.deepEqual(diagnosticsOf('public int F() { return 1; }'), ['CS0106@0 "public"']);
  assert.deepEqual(diagnosticsOf('static int F() => 1; async void G() { }'), [], 'static and async are local-function modifiers');
  const inNamespace = diagnosticsOf('namespace N { public int F() { return 1; } }').map(entry => entry.split('@')[0]);
  assert(!inNamespace.includes('CS0106'), 'inside a namespace it stays a member');
});

test('a token that starts nothing at compilation-unit level reports CS1022', () => {
  assert.deepEqual(diagnosticsOf('int x = 1;\n: x++;\n'), ['CS1022@11 ":"']);
  assert.equal(SyntaxTree.parseText('int x = 1;\n: x++;\n').toFullString(), 'int x = 1;\n: x++;\n');
});

test('inside a type nothing changes: record is a type name at LangVersion 8', () => {
  const [type] = unitMembers('class C { record field; record M(record p) { return p; } record R2(int X); }', '8');
  assert.deepEqual(
    type.members.map(member => member.kind),
    ['FieldDeclaration', 'MethodDeclaration', 'MethodDeclaration']
  );
});

test('the legacy entry point still accepts top-level functions and statements', () => {
  const legacy = parse('static int Twice(int v) { return v * 2; } int x = Twice(2); Console.WriteLine(x);');
  assert.deepEqual(legacy.diagnostics, []);
});
