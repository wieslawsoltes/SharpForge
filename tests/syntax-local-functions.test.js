import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T33: C# 7.0 local functions.
test('T33 local functions with modifiers, attributes, generics and both body forms match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/local-functions.cs');
  assert(kinds.has('LocalFunctionStatement'));
  assert.deepEqual(tree.getDiagnostics(), []);
  const functions = [...tree.root.descendantNodes()].filter(node => node.kind === 'LocalFunctionStatement');
  assert(functions.length >= 36, String(functions.length));
  const modifiers = new Set(functions.flatMap(node => node.modifiers.map(modifier => modifier.kind)));
  assert.deepEqual([...modifiers].sort(), ['AsyncKeyword', 'ExternKeyword', 'StaticKeyword', 'UnsafeKeyword']);
  assert(functions.some(node => node.attributeLists.length === 2));
});

test('T33 a name followed by ( or < makes a local function; anything else is a variable or an expression', () => {
  const statements = statementsOf('int Add(int a, int b) { return a + b; } int x = Add(1, 2); Add(1, 2); T Id<T>(T t) => t; int y;');
  assert.deepEqual(
    statements.map(statement => statement.kind),
    ['LocalFunctionStatement', 'LocalDeclarationStatement', 'ExpressionStatement', 'LocalFunctionStatement', 'LocalDeclarationStatement']
  );
  assert.equal(
    shapeOf(statementsOf('int Twice(int a) => a * 2;')[0]),
    'LocalFunctionStatement(PredefinedType(int) Twice ParameterList(( Parameter(PredefinedType(int) a) )) ' +
      'ArrowExpressionClause(=> MultiplyExpression(IdentifierName(a) * NumericLiteralExpression(2))) ;)'
  );
  assert.equal(statements[3].typeParameterList.parameters.length, 1);
});

test('T33 await is an operator only in async local functions', () => {
  const [asynchronous, plain] = statementsOf('async Task A() { await x; } void B() { await x; }');
  assert.equal(asynchronous.body.statements[0].kind, 'ExpressionStatement');
  assert.equal(asynchronous.body.statements[0].expression.kind, 'AwaitExpression');
  assert.equal(plain.body.statements[0].kind, 'LocalDeclarationStatement', 'a local named x of type await');
});

test('T33 local functions need C# 7; static needs 8; extern and attributes need 9', () => {
  const source = body => `class C { void M() { ${body} } }`;
  assert.deepEqual(diagnosticsOf(source('int Twice(int a) => a * 2;'), '6'), ['CS8059@21 "int"']);
  assert.deepEqual(diagnosticsOf(source('int Twice(int a) => a * 2;'), '7'), []);
  assert.deepEqual(diagnosticsOf(source('async Task A() { } unsafe void U() { }'), '7'), [], 'async and unsafe are C# 7 modifiers');
  assert.deepEqual(diagnosticsOf(source('static int S(int a) => a;'), '7.3'), ['CS8370@21 "static"']);
  assert.deepEqual(diagnosticsOf(source('static int S(int a) => a;'), '8'), []);
  assert.deepEqual(diagnosticsOf(source('static extern int E(int a);'), '8'), ['CS8400@28 "extern"']);
  assert.deepEqual(diagnosticsOf(source('[A] void L() { }'), '8'), ['CS8400@21 "[A]"']);
  assert.deepEqual(diagnosticsOf(source('[A][B] static extern int E(int a);'), '9'), []);
});

test('T33 malformed local functions recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp7/local-functions-recovery.cs');
  const functions = [...tree.root.descendantNodes()].filter(node => node.kind === 'LocalFunctionStatement');
  assert.equal(functions.length, 5, 'every function survives a missing body, parameter list or parenthesis');
  assert.equal(functions[2].parameterList.parameters.length, 0, '`void Broken( { }` has no parameter');
});
