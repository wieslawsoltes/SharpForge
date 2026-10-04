import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: `b ? () => 1 : null` was a syntax error (CS1002, CS1525), because
// `b ? (...) =>` was read as a lambda with the explicit return type `b?`. Roslyn reads the `?` as the conditional
// operator when a `:` follows the lambda and as a nullable return type otherwise.
test('lambdas as operands of the conditional operator match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp9-10/conditional-lambda.cs');
  for (const kind of ['ConditionalExpression', 'ParenthesizedLambdaExpression', 'SimpleLambdaExpression', 'AnonymousMethodExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('`b ? () => 1 : null` is a conditional expression with a lambda in the middle', () => {
  for (const text of ['b ? () => 1 : null', 'b ? (x) => x : null', 'b ? (int x) => x : y => y', 'b ? () => { } : null', 'b ? (x, y) => x : null']) {
    const expression = expressionOf(text);
    assert.equal(expression.kind, 'ConditionalExpression', text);
    assert.equal(expression.whenTrue.kind, 'ParenthesizedLambdaExpression', text);
    assert.equal(expression.whenTrue.returnType, null, text);
  }
  assert.deepEqual(diagnosticsOf('class C { void M() { var f = b ? () => 1 : null; } }'), []);
});

test('nested conditionals and a conditional inside the lambda body pair their colons', () => {
  const nested = expressionOf('b ? c ? () => 1 : () => 2 : () => 3');
  assert.equal(nested.whenTrue.kind, 'ConditionalExpression');
  assert.equal(nested.whenFalse.kind, 'ParenthesizedLambdaExpression');
  const inner = expressionOf('b ? () => c ? 1 : 2 : null');
  assert.equal(inner.whenTrue.expressionBody?.kind ?? inner.whenTrue.body?.kind, 'ConditionalExpression');
  assert.equal(inner.whenFalse.kind, 'NullLiteralExpression');
});

test('without a colon after the lambda, `T? (...) =>` is a lambda with a nullable return type', () => {
  for (const text of ['b? () => null', 'int? () => null', 'A.B? (int x) => null']) {
    const lambda = expressionOf(text);
    assert.equal(lambda.kind, 'ParenthesizedLambdaExpression', text);
    assert.equal(lambda.returnType.kind, 'NullableType', text);
  }
  const typed = expressionOf('b ? int? () => null : null');
  assert.equal(typed.kind, 'ConditionalExpression', 'a predefined type is never a condition');
  assert.equal(typed.whenTrue.returnType.kind, 'NullableType');
});

test('a ref-returning lambda in a conditional branch is a lambda, not a ref expression', () => {
  const expression = expressionOf('b ? ref int () => ref xs[0] : null');
  assert.equal(expression.whenTrue.kind, 'ParenthesizedLambdaExpression');
  assert.equal(expression.whenTrue.returnType.kind, 'RefType');
  assert.equal(expressionOf('b ? ref xs[0] : ref xs[1]').whenTrue.kind, 'RefExpression');
});

test('the ambiguous forms recover as Roslyn does', () => {
  // `b ? c? () => null : null`: the inner `?` takes the colon, so the outer conditional has none.
  assertRecoversLikeRoslyn('reference/csharp9-10/conditional-lambda-nullable.cs');
});
