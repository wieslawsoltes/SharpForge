import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T39: C# 8 switch expressions with full pattern arms.
test('T39 switch expressions with every pattern form match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp8/switch-expression.cs');
  for (const kind of [
    'SwitchExpression',
    'SwitchExpressionArm',
    'WhenClause',
    'DeclarationPattern',
    'RecursivePattern',
    'RelationalPattern',
    'AndPattern',
    'OrPattern',
    'NotPattern',
    'ListPattern',
    'VarPattern',
    'DiscardPattern',
    'ConstantPattern',
    'TypePattern'
  ])
    assert(kinds.has(kind), kind);
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => [diagnostic.code, diagnostic.severity]),
    [['CS8848', 'warning']],
    'only the precedence warning for `i as int? switch`'
  );
});

test('T39 arms take a pattern, an optional when clause and a result', () => {
  assert.equal(
    shapeOf(expressionOf('o switch { int n when n > 0 => 1, _ => 0 }')),
    'SwitchExpression(IdentifierName(o) switch { ' +
      'SwitchExpressionArm(DeclarationPattern(PredefinedType(int) SingleVariableDesignation(n)) ' +
      'WhenClause(when GreaterThanExpression(IdentifierName(n) > NumericLiteralExpression(0))) => NumericLiteralExpression(1)) , ' +
      'SwitchExpressionArm(DiscardPattern(_) => NumericLiteralExpression(0)) })'
  );
  assert.equal(expressionOf('o switch { }').arms.length, 0);
  assert.equal(expressionOf('o switch { 1 => 2, }').arms.length, 1, 'a trailing comma is allowed');
  assert.equal(expressionOf('i switch { 1 => throw new E(), _ => 0 }').arms[0].expression.kind, 'ThrowExpression');
  assert.deepEqual(diagnosticsOf('class C { int M(int i) => i switch { 1 => throw new E(), _ => 0 }; }'), [], 'throw is allowed as an arm result');
  assert.equal(expressionOf('o switch { global::A.D => 1, _ => 2 }').arms[0].pattern.kind, 'ConstantPattern');
});

test('T39 switch binds tighter than relational and arithmetic operators and looser than a range', () => {
  assert.equal(expressionOf('i + 1 switch { 2 => true, _ => false }').kind, 'AddExpression');
  assert.equal(expressionOf('i == 1 switch { true => 1, _ => 0 }').kind, 'EqualsExpression');
  assert.equal(expressionOf('(i + 1) switch { 2 => true, _ => false }').kind, 'SwitchExpression');
  assert.equal(expressionOf('-i switch { 1 => 2, _ => 3 }').governingExpression.kind, 'UnaryMinusExpression');
  assert.equal(expressionOf('i..j switch { _ => 1 }').governingExpression.kind, 'RangeExpression');
  assert.equal(expressionOf('i switch { 1 => 2 } switch { 2 => 3 }').governingExpression.kind, 'SwitchExpression');
  assert.equal(expressionOf('i switch { 1 => 2, _ => 3 } + 1').kind, 'AddExpression');
  assert.equal(expressionOf('a ? b : i switch { 1 => 2, _ => 3 }').whenFalse.kind, 'SwitchExpression');
});

test('T39 switch after `as` or `is` warns about precedence, as Roslyn does', () => {
  const source = 'class C { void M() { var _ = x as T switch { _ => 1 }; } }';
  assert.deepEqual(diagnosticsOf(source), ['CS8848@36 "switch"']);
  assert.equal(expressionOf('x as T switch { _ => 1 }').governingExpression.kind, 'AsExpression');
});

test('T39 switch expressions are rejected below C# 8 and recover as Roslyn does', () => {
  assert.deepEqual(diagnosticsOf('class C { void M() { var _ = o switch { _ => 0 }; } }', '7.3'), ['CS8370@31 "switch"']);
  assert.deepEqual(diagnosticsOf('class C { void M() { var _ = o switch { _ => 0 }; } }', '8'), []);
  const { tree } = assertRecoversLikeRoslyn('reference/csharp8/switch-expression-recovery.cs');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS1003', 'CS1525', 'CS1003', 'CS8504', 'CS1002', 'CS1513'],
    'missing comma, missing result, missing arrow, missing pattern, unterminated'
  );
  const switches = [...tree.root.descendantNodes()].filter(node => node.kind === 'SwitchExpression');
  assert.deepEqual(
    switches.map(node => node.arms.length),
    [2, 2, 2, 1, 2]
  );
});
