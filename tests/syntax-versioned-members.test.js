import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T07: modern member forms - records, record structs, init/required, primary constructors and partial members.
const members = (text, options) => SyntaxTree.parseText(text, options).root.members;
test('T07.1 records: declarations and with expressions match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/versioned/records.cs');
  for (const kind of ['RecordDeclaration', 'RecordStructDeclaration', 'PrimaryConstructorBaseType', 'WithExpression', 'WithInitializerExpression']) assert(kinds.has(kind), kind);
  const records = [...tree.root.descendantNodes()].filter(n => n.kind === 'RecordDeclaration'); assert(records.length >= 10);
  assert.deepEqual(records.slice(0, 5).map(r => [r.identifier.text, r.classOrStructKeyword?.text ?? null, !!r.parameterList, !!r.semicolonToken]), [['Person', null, true, true], ['Employee', null, true, true], ['Empty', null, false, true], ['Braces', null, false, false], ['Explicit', 'class', true, false]]);
  assert.deepEqual(tree.getDiagnostics(), []);
});
test('T07.1 records: `record` remains an identifier at LangVersion 8', () => {
  const { kinds } = assertMatchesRoslyn('reference/versioned/records-langversion8.cs'); assert(!kinds.has('RecordDeclaration')); assert(kinds.has('FieldDeclaration') && kinds.has('MethodDeclaration') && kinds.has('PropertyDeclaration'));
  const text = 'class C { record field; record M(record p) { return p; } }';
  assert.deepEqual(members(text, { languageVersion: '8' })[0].members.map(m => m.kind), ['FieldDeclaration', 'MethodDeclaration']); assert.deepEqual(diagnosticsOf(text, '8'), []);
  assert.deepEqual(members('record R(int X);', { languageVersion: '9' }).map(m => m.kind), ['RecordDeclaration']); assert.deepEqual(diagnosticsOf('record R(int X);', '9'), []);
  assert.deepEqual(members('record R(int X);', { languageVersion: '8' }).map(m => m.statement?.kind), ['LocalFunctionStatement'], 'below C# 9 this is a function returning a type named record');
  assert.deepEqual(members('class C { record field; }', { languageVersion: '9' })[0].members.map(m => m.kind), ['RecordDeclaration'], 'from C# 9 on record always starts a declaration, as in Roslyn');
  assert.deepEqual(diagnosticsOf('class C { void M() { var b = a with { X = 1 }; } }', '8'), ['CS8400@31 "with"']);
  const statements = members('class C { void M() { int record = 1; record++; var with = record; with = with + 1; } }')[0].members[0].body.statements; assert.deepEqual(statements.map(s => s.kind), ['LocalDeclarationStatement', 'ExpressionStatement', 'LocalDeclarationStatement', 'ExpressionStatement']);
  assert.equal(shapeOf(members('record = 5;')[0]), 'RecordDeclaration(record <IdentifierToken> <OpenBraceToken> <CloseBraceToken>)');
});
test('T07.2 record structs: forms match Roslyn and LangVersion 9 reports CS8773', () => {
  assert.equal(shapeOf(members('readonly record struct P(int X, int Y);')[0]), 'RecordStructDeclaration(readonly record struct P ParameterList(( Parameter(PredefinedType(int) X) , Parameter(PredefinedType(int) Y) )) ;)');
  assert.deepEqual(diagnosticsOf('readonly record struct P(int X, int Y);', '9'), ['CS8773@16 "struct"']); assert.deepEqual(diagnosticsOf('readonly record struct P(int X, int Y);', '10'), []);
  assert.deepEqual(diagnosticsOf('record class R(int X);', '9'), ['CS8773@7 "class"'], 'the explicit class form is a C# 10 feature too'); assert.deepEqual(diagnosticsOf('record struct S { }', '8').length > 0, true);
  const struct = members('partial record struct S<T>(T Value) : I where T : struct { public T Other; }')[0]; assert.equal(struct.kind, 'RecordStructDeclaration'); assert.equal(struct.members.length, 1); assert.equal(struct.constraintClauses.length, 1);
});
test('T07.3 init accessors and required members match Roslyn; the words stay identifiers elsewhere', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/versioned/init-required.cs'); assert(kinds.has('InitAccessorDeclaration')); assert.deepEqual(tree.getDiagnostics(), []);
  const required = [...tree.root.descendantTokens()].filter(t => t.text === 'required'); assert.deepEqual(required.map(t => t.kind), ['RequiredKeyword', 'RequiredKeyword', 'RequiredKeyword', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'RequiredKeyword', 'RequiredKeyword']);
  const init = [...tree.root.descendantTokens()].filter(t => t.text === 'init'); assert.equal(init.filter(t => t.kind === 'InitKeyword').length, 6); assert(init.filter(t => t.kind === 'IdentifierToken').length >= 6);
  const text = 'class C { public required int X { get; init; } }';
  assert.deepEqual(diagnosticsOf(text, '8'), ['CS8400@17 "required"', 'CS8400@39 "init"']); assert.deepEqual(diagnosticsOf(text, '10'), ['CS8936@17 "required"']); assert.deepEqual(diagnosticsOf(text, '11'), []);
  assert.deepEqual(diagnosticsOf('class C { int required; int init; void M() { required = init; } int P { get { int init = 1; return init; } } }', '2'), []);
  assert.deepEqual(parse('class C { int Count { get; set; } void M() { int init = 1, required = 2; Count = init + required; } }').diagnostics.filter(d => d.code.startsWith('CS')), []);
});
test('T07.4 primary constructors match Roslyn and LangVersion 11 reports the feature diagnostic', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/versioned/primary-constructors.cs'); assert(kinds.has('PrimaryConstructorBaseType')); assert.deepEqual(tree.getDiagnostics(), []);
  assert.deepEqual(tree.root.members.map(m => [m.kind, !!m.parameterList, !!m.semicolonToken && !m.openBraceToken]).slice(0, 5), [['ClassDeclaration', true, false], ['ClassDeclaration', true, false], ['StructDeclaration', true, true], ['InterfaceDeclaration', true, true], ['ClassDeclaration', true, true]]);
  assert.deepEqual(diagnosticsOf('class Point(int x, int y) : Base(x) { }', '11'), ['CS9058@11 "("']); assert.deepEqual(diagnosticsOf('class Point(int x, int y) : Base(x) { }', '12'), []);
  assert.deepEqual(diagnosticsOf('struct S(int a);', '11'), ['CS9058@8 "("']); assert.deepEqual(diagnosticsOf('record R(int a);', '9'), [], 'positional records are C# 9, not primary constructors');
});
test('T07.5 partial members match Roslyn and are gated per version', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/versioned/partial-members.cs'); for (const kind of ['MethodDeclaration', 'PropertyDeclaration', 'IndexerDeclaration', 'ConstructorDeclaration', 'EventFieldDeclaration', 'EventDeclaration']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const gate = (member, version) => diagnosticsOf(`partial class C { ${member} }`, version).map(d => d.split('@')[0]);
  assert.deepEqual(gate('partial void M();', '2'), ['CS8023']); assert.deepEqual(gate('partial void M();', '3'), []);
  assert.deepEqual(gate('public partial int M();', '8'), ['CS8400']); assert.deepEqual(gate('partial int M();', '8'), ['CS8400']); assert.deepEqual(gate('public partial int M();', '9'), []);
  assert.deepEqual(gate('public partial int P { get; }', '12'), ['CS9202']); assert.deepEqual(gate('public partial int this[int i] { get; }', '12'), ['CS9202']); assert.deepEqual(gate('public partial int P { get; }', '13'), []);
  assert.deepEqual(gate('public partial C();', '13'), ['CS9260']); assert.deepEqual(gate('public partial event System.Action E;', '13'), ['CS9260']); assert.deepEqual(gate('public partial event System.Action E { add { } remove { } }', '13'), ['CS9260']);
  assert.deepEqual(gate('public partial C(); public partial event System.Action E;', '14'), []);
  assert.deepEqual(diagnosticsOf('partial class C { public partial int P { get; } }', '12'), ['CS9202@37 "P"'], 'the diagnostic is on the member name');
});
