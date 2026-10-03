import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T38: C# 8 index-from-end and range expressions.
test('T38 index and range expressions match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp8/ranges.cs');
  for (const kind of ['IndexExpression', 'RangeExpression', 'SlicePattern']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T38 a[^1], a[1..^2], .. and x.. have the Roslyn shapes', () => {
  assert.equal(shapeOf(expressionOf('a[^1]').argumentList.arguments[0]), 'Argument(IndexExpression(^ NumericLiteralExpression(1)))');
  assert.equal(
    shapeOf(expressionOf('a[1..^2]').argumentList.arguments[0]),
    'Argument(RangeExpression(NumericLiteralExpression(1) .. IndexExpression(^ NumericLiteralExpression(2))))'
  );
  assert.equal(shapeOf(expressionOf('..')), 'RangeExpression(..)');
  assert.equal(shapeOf(expressionOf('x..')), 'RangeExpression(IdentifierName(x) ..)');
  assert.equal(shapeOf(expressionOf('..y')), 'RangeExpression(.. IdentifierName(y))');
});

test('T38 a range binds tighter than binary operators and looser than unary ones', () => {
  assert.equal(
    shapeOf(expressionOf('i + 1..j - 1')),
    'SubtractExpression(AddExpression(IdentifierName(i) + RangeExpression(NumericLiteralExpression(1) .. IdentifierName(j))) - NumericLiteralExpression(1))'
  );
  assert.equal(
    shapeOf(expressionOf('^1..^2')),
    'RangeExpression(IndexExpression(^ NumericLiteralExpression(1)) .. IndexExpression(^ NumericLiteralExpression(2)))'
  );
  assert.equal(expressionOf('-1..-2').kind, 'RangeExpression');
  assert.equal(expressionOf('i..j == r').kind, 'EqualsExpression');
  assert.equal(expressionOf('i..j switch { _ => 1 }').kind, 'SwitchExpression', 'switch applies to the whole range');
  assert.equal(expressionOf('a ^ b').kind, 'ExclusiveOrExpression', 'binary ^ is still exclusive or');
  assert.equal(expressionOf('x is ..').pattern.kind, 'SlicePattern', 'after `is` a `..` is a slice pattern, as in Roslyn');
});

test('T38 ranges reach the legacy AST as nodes under their Roslyn names', () => {
  const legacy = parse('class C { void M(int[] a) { var b = a[1..^2]; var c = ^1; } }');
  const [slice, index] = legacy.root.members[0].members[0].body.statements.map(statement => statement.declarations[0].initializer);
  assert.equal(slice.kind, 'Index');
  assert.equal(slice.index.kind, 'RangeExpression', 'a range is a node of its own, not a call to a built-in helper');
  assert.equal(index.kind, 'IndexExpression');
  assert.deepEqual(legacy.diagnostics, []);
});

test('T38 ^ and .. are rejected below C# 8 and recover as Roslyn does', () => {
  assert.deepEqual(diagnosticsOf('class C { void M() { var _ = a[^1]; } }', '7.3'), ['CS8370@31 "^"']);
  assert.deepEqual(diagnosticsOf('class C { void M() { var _ = 1..2; } }', '7.3'), ['CS8370@30 ".."']);
  assert.deepEqual(diagnosticsOf('class C { void M() { var _ = a[^1]; var r = 1..2; } }', '8'), []);
  assert.deepEqual(diagnosticsOf('class C { void M(int a, int b) { int c = a ^ b; } }', '1'), [], 'binary ^ is C# 1');
  const { tree } = assertRecoversLikeRoslyn('reference/csharp8/ranges-recovery.cs');
  const ranges = [...tree.root.descendantNodes()].filter(node => node.kind === 'RangeExpression');
  assert.equal(ranges.length, 3, '`1..2..3` and an unterminated `a[..` keep their range nodes');
});
