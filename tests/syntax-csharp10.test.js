import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFeature } from '@sharpforge/syntax';
import {
  assertGatesMatchRoslyn,
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  diagnosticsOf,
  expressionOf,
  shapeOf,
  statementsOf
} from './support/syntax-reference.js';

// SF-A01-T45: C# 10 lambda attributes, explicit return types, mixed deconstruction, struct constructors and initializers.
test('T45 lambda attributes and return types, mixed deconstruction and struct members match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp9-10/csharp10.cs');
  for (const kind of ['ParenthesizedLambdaExpression', 'SimpleLambdaExpression', 'AttributeList', 'DeclarationExpression', 'RecordStructDeclaration'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const lambdas = [...tree.root.descendantNodes()].filter(node => /LambdaExpression$/.test(node.kind));
  assert(lambdas.filter(node => node.attributeLists.length).length >= 12);
  assert(lambdas.filter(node => node.returnType).length >= 12);
});

test('T45 attributes come first, then modifiers, then the return type', () => {
  const lambda = expressionOf('[A][B(1)] static async Task<int> (int x) => await y');
  assert.equal(lambda.kind, 'ParenthesizedLambdaExpression');
  assert.equal(lambda.attributeLists.length, 2);
  assert.deepEqual(
    lambda.modifiers.map(modifier => modifier.kind),
    ['StaticKeyword', 'AsyncKeyword']
  );
  assert.equal(shapeOf(lambda.returnType), 'GenericName(Task TypeArgumentList(< PredefinedType(int) >))');
  assert.equal(shapeOf(expressionOf('[return: A] () => 1').attributeLists[0].target), 'AttributeTargetSpecifier(return :)');
  assert.equal(expressionOf('([A] ref int x) => x').parameterList.parameters[0].attributeLists.length, 1);
  assert.equal(expressionOf('[A] x => x').kind, 'SimpleLambdaExpression');
  assert.equal(expressionOf('ref int (ref int x) => ref x').returnType.kind, 'RefType');
});

test('T45 a bracket that no lambda follows is still a collection expression', () => {
  assert.equal(expressionOf('[A]').kind, 'CollectionExpression');
  assert.equal(expressionOf('[a, b]').kind, 'CollectionExpression');
  assert.equal(expressionOf('[A] (x)').kind, 'InvocationExpression');
  assert.equal(expressionOf('x[A] (y)').kind, 'InvocationExpression');
});

test('T45 a deconstruction may mix declarations with existing variables', () => {
  const [mixed, nested] = statementsOf('(x, var y) = t; (x, int a, var (b, c)) = u;');
  assert.equal(
    shapeOf(mixed.expression.left),
    'TupleExpression(( Argument(IdentifierName(x)) , Argument(DeclarationExpression(IdentifierName(var) SingleVariableDesignation(y))) ))'
  );
  assert.deepEqual(
    nested.expression.left.arguments.map(argument => argument.expression.kind),
    ['IdentifierName', 'DeclarationExpression', 'DeclarationExpression']
  );
  assert.equal(nested.expression.left.arguments[2].expression.designation.kind, 'ParenthesizedVariableDesignation');
});

test('T45 the 10.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp10.rejected.cs');
  assert.equal(agreed.length, 14);
  const inMethod = body => `class C { void M() { ${body} } }`;
  assert.deepEqual(diagnosticsOf(inMethod('F([A] () => 1);'), '9'), ['CS8773@23 "[A]"']);
  assert.deepEqual(diagnosticsOf(inMethod('F(int () => 1);'), '9'), ['CS8773@23 "int"']);
  assert.deepEqual(diagnosticsOf(inMethod('(x, var y) = t;'), '9'), ['CS8773@21 "(x, var y) = t"']);
  assert.deepEqual(diagnosticsOf(inMethod('(x, y) = t; (var a, var b) = t; var (c, d) = t;'), '9'), [], 'all-or-nothing deconstruction is C# 7');
  assert.deepEqual(diagnosticsOf('struct S { public int X = 1; }', '9'), ['CS8773@22 "X"']);
  assert.deepEqual(diagnosticsOf('struct S { public int P { get; } = 1; }', '9'), ['CS8773@22 "P"']);
  assert.deepEqual(diagnosticsOf('struct S { public S() { } }', '9'), ['CS8773@18 "S"']);
  assert.deepEqual(diagnosticsOf('struct S { static int X = 1; const int Y = 2; static S() { } public S(int a) { } }', '9'), []);
  assert.deepEqual(diagnosticsOf('class C { int X = 1; public C() { } }', '1'), [], 'classes always allowed both');
  assert.deepEqual(
    diagnosticsOf('struct S { public int X = 1; public S() { } } class C { void M() { F([A] int () => 1); (x, var y) = t; } }', '10'),
    []
  );
});

test('T45 features that need the binder are in the catalog without a parser gate', () => {
  for (const id of ['InferredDelegateType', 'ConstantInterpolatedStrings', 'SealedToStringInRecord', 'ImprovedInterpolatedStrings'])
    assert.equal(languageFeature(id).version, 10);
  assert.deepEqual(diagnosticsOf('class C { void M() { var f = () => 1; } }', '9'), []);
});

test('T45 malformed lambdas and deconstructions recover as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp9-10/csharp10-recovery.cs');
});
