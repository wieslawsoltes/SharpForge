import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A02-T30 (found by the stress corpus): three places where a valid program did not parse. Reference: Roslyn 5.3.0
// compiles the corpus fixtures `reduced-patterns/arm-guards-and-throw` and `reduced-patterns/constant-precedence`
// without a diagnostic; the precedences are those of Roslyn's ParsePattern callers (after `is`: Relational, a
// subpattern, a list element and a case label: Conditional, a switch expression arm: Coalescing).

const wrap = body => `class C { object M(object o, int n, bool b) { ${body} } }`;

test('an invocation before the arrow of a switch arm is not the parameter list of a lambda with a return type', () => {
  const guarded = expressionOf('e switch { Var v when env.TryGetValue(v.Name, out var value) => value, _ => 0 }');
  assert.equal(guarded.arms.length, 2);
  assert.equal(guarded.arms[0].whenClause.condition.kind, 'InvocationExpression');
  assert.equal(guarded.arms[0].expression.kind, 'IdentifierName');
  const methodGroup = expressionOf('o switch { string s when s.All(char.IsUpper) => 1, _ => 2 }');
  assert.equal(methodGroup.arms[0].whenClause.condition.kind, 'InvocationExpression');
  assert.deepEqual(diagnosticsOf(wrap('return o switch { string s when s.All(char.IsUpper) => 1, _ => 2 };')), []);
});

test('a lambda with a return type is still recognised by its parameter list', () => {
  for (const text of ['int (int x) => x', 'int () => 1', 'static int (x) => x', 'T (ref int a, out string b) => default', 'int (int x = 1, params int[] rest) => x']) {
    assert.equal(expressionOf(text).kind, 'ParenthesizedLambdaExpression', text);
  }
  assert.equal(expressionOf('f(a.b) ').kind, 'InvocationExpression');
});

test('a constant in a subpattern, a list element or a case label runs up to the conditional operator', () => {
  const property = expressionOf('o is File { Flags: Access.Read | Access.Write, Size: A + B << 1 }');
  assert.equal(
    shapeOf(property.pattern.propertyPatternClause),
    'PropertyPatternClause({ ' +
      'Subpattern(NameColon(IdentifierName(Flags) :) ConstantPattern(BitwiseOrExpression(' +
      'SimpleMemberAccessExpression(IdentifierName(Access) . IdentifierName(Read)) | SimpleMemberAccessExpression(IdentifierName(Access) . IdentifierName(Write))))) , ' +
      'Subpattern(NameColon(IdentifierName(Size) :) ConstantPattern(LeftShiftExpression(' +
      'AddExpression(IdentifierName(A) + IdentifierName(B)) << NumericLiteralExpression(1)))) })',
  );
  assert.equal(expressionOf('o is [A | B, .. [C & D]]').pattern.patterns[0].expression.kind, 'BitwiseOrExpression');
  assert.equal(expressionOf('o is (A | B, 1)').pattern.positionalPatternClause.subpatterns[0].pattern.expression.kind, 'BitwiseOrExpression');
  assert.deepEqual(diagnosticsOf(wrap('switch (n) { case A | 1: return 1; case A + B when b: return 2; default: return 3; }')), []);
});

test('a constant directly after `is` ends before a relational or bitwise operator', () => {
  assert.equal(shapeOf(expressionOf('x is A | b')), 'BitwiseOrExpression(IsExpression(IdentifierName(x) is IdentifierName(A)) | IdentifierName(b))');
  assert.equal(expressionOf('x is 1 + 2').kind, 'IsPatternExpression');
  assert.equal(expressionOf('x is 1 + 2').pattern.expression.kind, 'AddExpression');
  assert.equal(expressionOf('x is 1 == true').kind, 'EqualsExpression');
});

test('a constant in a switch expression arm runs up to the null-coalescing operator', () => {
  const arms = expressionOf('o switch { A | B => 1, C ?? D => 2, _ => 3 }').arms;
  assert.equal(arms[0].pattern.expression.kind, 'BitwiseOrExpression');
  assert.equal(arms[1].pattern.expression.kind, 'CoalesceExpression');
});

test('`T?[]` is a type in a pattern although an expression could follow the `?`', () => {
  const arm = expressionOf('o switch { int?[] items => 1, _ => 2 }').arms[0];
  assert.equal(shapeOf(arm.pattern), 'DeclarationPattern(ArrayType(NullableType(PredefinedType(int) ?) ArrayRankSpecifier([ OmittedArraySizeExpression() ])) SingleVariableDesignation(items))');
  assert.equal(expressionOf('o is int?[] items').kind, 'IsPatternExpression');
  // The conditional operator after a type test is unchanged.
  assert.equal(expressionOf('o is int ? [1] : [2]').kind, 'ConditionalExpression');
  assert.equal(expressionOf('o is A * 2').kind, 'IsPatternExpression');
});
