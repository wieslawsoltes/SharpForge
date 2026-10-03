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

// SF-A01-T43: C# 9 target-typed new, native integers and lambda refinements.
test('T43 target-typed new, nint/nuint, static anonymous functions and lambda discards match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp9-10/csharp9.cs');
  for (const kind of ['ImplicitObjectCreationExpression', 'SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'AnonymousMethodExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T43 new() is an ImplicitObjectCreation with arguments and an optional initializer', () => {
  assert.equal(shapeOf(expressionOf('new()')), 'ImplicitObjectCreationExpression(new ArgumentList(( )))');
  assert.equal(
    shapeOf(expressionOf('new(1) { X = 2 }')),
    'ImplicitObjectCreationExpression(new ArgumentList(( Argument(NumericLiteralExpression(1)) )) ' +
      'ObjectInitializerExpression({ SimpleAssignmentExpression(IdentifierName(X) = NumericLiteralExpression(2)) }))'
  );
  assert.equal(expressionOf('new() { 1, 2 }').initializer.kind, 'CollectionInitializerExpression');
  assert.equal(expressionOf('new (int, int)()').kind, 'ObjectCreationExpression', 'a tuple type after new is not an argument list');
  assert.equal(expressionOf('new (int, int)[2]').kind, 'ArrayCreationExpression');
  assert.equal(expressionOf('new(a, b)').kind, 'ImplicitObjectCreationExpression');
});

test('T43 nint and nuint are identifiers used as type names', () => {
  const [typed, cast, variable, assignment] = statementsOf('nint n = 1; nuint u = (nuint)n; int nint = 1; nint = nint + 1;');
  assert.equal(shapeOf(typed.declaration.type), 'IdentifierName(nint)');
  assert.equal(cast.declaration.variables[0].initializer.value.kind, 'CastExpression');
  assert.equal(variable.declaration.variables[0].identifier.text, 'nint');
  assert.equal(assignment.kind, 'ExpressionStatement');
  // Whether the name means the native integer type depends on what it binds to, so the parser has no gate for it.
  assert.equal(languageFeature('NativeInt').version, 9);
  assert.deepEqual(diagnosticsOf('class C { nint a; void M() { nuint b = 1; } }', '8'), []);
});

test('T43 static lambdas and anonymous methods keep the modifier; several `_` parameters are discards', () => {
  const lambda = expressionOf('static (x, y) => x + y');
  assert.deepEqual(
    lambda.modifiers.map(modifier => modifier.kind),
    ['StaticKeyword']
  );
  assert.deepEqual(
    expressionOf('async static () => await x').modifiers.map(modifier => modifier.kind),
    ['AsyncKeyword', 'StaticKeyword']
  );
  assert.equal(expressionOf('static delegate { return 1; }').modifiers[0].kind, 'StaticKeyword');
  assert.deepEqual(
    expressionOf('(_, _) => 1').parameterList.parameters.map(parameter => parameter.identifier.text),
    ['_', '_']
  );
});

test('T43 the 9.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp9.rejected.cs');
  assert.equal(agreed.length, 11, 'five target-typed new, three static functions, three second discards');
  const inMethod = body => `class C { void M() { ${body} } }`;
  assert.deepEqual(diagnosticsOf(inMethod('P p = new();'), '8'), ['CS8400@27 "new"']);
  assert.deepEqual(diagnosticsOf(inMethod('F(static x => x);'), '8'), ['CS8400@23 "static"']);
  assert.deepEqual(diagnosticsOf(inMethod('F((_, _) => 1);'), '8'), ['CS8400@27 "_"']);
  assert.deepEqual(diagnosticsOf(inMethod('F(_ => 1, (_, a) => 2);'), '8'), [], 'one parameter named _ is an ordinary parameter');
  assert.deepEqual(diagnosticsOf(inMethod('P p = new(); F(static x => x); F((_, _) => 1);'), '9'), []);
});

test('T43 malformed target-typed new and static lambdas recover as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp9-10/csharp9-recovery.cs');
});
