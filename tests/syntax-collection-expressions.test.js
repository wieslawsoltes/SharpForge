import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T48: C# 12 collection expressions as structured nodes.
test('T48 collection expressions and their ambiguities match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp11-12/collection-expressions.cs');
  for (const kind of ['CollectionExpression', 'ExpressionElement', 'SpreadElement', 'CastExpression', 'ElementAccessExpression', 'ListPattern'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T48 [1, ..xs] and [..a, ..b] have element and spread nodes', () => {
  assert.equal(
    shapeOf(expressionOf('[1, ..xs]')),
    'CollectionExpression([ ExpressionElement(NumericLiteralExpression(1)) , SpreadElement(.. IdentifierName(xs)) ])'
  );
  assert.deepEqual(
    expressionOf('[..a, ..b]').elements.map(element => element.kind),
    ['SpreadElement', 'SpreadElement']
  );
  assert.equal(expressionOf('[]').elements.length, 0);
  assert.equal(expressionOf('[1, 2,]').elements.length, 2, 'a trailing comma is allowed');
  assert.equal(expressionOf('[[1], []]').elements[0].expression.kind, 'CollectionExpression');
  assert.equal(expressionOf('[.. a ? b : c]').elements[0].expression.kind, 'ConditionalExpression');
});

test('T48 (T)[...] is a cast only when T must be a type or is generic', () => {
  assert.equal(expressionOf('(int[])[1]').kind, 'CastExpression');
  assert.equal(expressionOf('(int[])[1]').expression.kind, 'CollectionExpression');
  assert.equal(expressionOf('(List<int>)[1, 2]').kind, 'CastExpression');
  assert.equal(expressionOf('(int)[1]').kind, 'CastExpression');
  assert.equal(expressionOf('(a)[1]').kind, 'ElementAccessExpression', 'a parenthesised expression is indexed');
  assert.equal(expressionOf('(A.B)[1]').kind, 'ElementAccessExpression');
  assert.equal(expressionOf('(a + b)[1]').kind, 'ElementAccessExpression');
});

test('T48 a bracket is an element access after an operand and an attribute list before a declaration', () => {
  const [index, local, collection, conditional] = statementsOf('var l = a[0]; [Attr] void Local() { } [1, 2].ToString(); a = c ? [1] : [2];');
  assert.equal(index.declaration.variables[0].initializer.value.kind, 'ElementAccessExpression');
  assert.equal(local.kind, 'LocalFunctionStatement');
  assert.equal(local.attributeLists.length, 1);
  assert.equal(collection.expression.expression.expression.kind, 'CollectionExpression');
  assert.equal(conditional.expression.right.kind, 'ConditionalExpression');
  assert.equal(expressionOf('xs is [1, 2]').pattern.kind, 'ListPattern', 'after `is` a bracket is a list pattern');
});

test('T48 the legacy adapter still gives the compiler its collection nodes', () => {
  const legacy = parse('class C { void M(int[] xs) { int[] a = [1, ..xs]; } }');
  const collection = legacy.root.members[0].members[0].body.statements[0].declarations[0].initializer;
  assert.equal(collection.kind, 'CollectionExpression');
  assert.deepEqual(legacy.diagnostics, []);
});

test('T48 collection expressions are rejected below C# 12 and recover as Roslyn does', () => {
  assert.deepEqual(diagnosticsOf('class C { void M() { int[] a = [1, 2]; } }', '11'), ['CS9058@31 "["']);
  assert.deepEqual(diagnosticsOf('class C { void M() { int[] a = [1, 2]; } }', '12'), []);
  assert.deepEqual(diagnosticsOf('class C { void M(int[] a) { var b = a[0]; if (a is [1, 2]) { } } }', '11'), [], 'indexing and list patterns are older');
  const { tree } = assertRecoversLikeRoslyn('reference/csharp11-12/collection-expressions-recovery.cs');
  const collections = [...tree.root.descendantNodes()].filter(node => node.kind === 'CollectionExpression');
  assert.equal(collections.length, 6);
  assert.equal(collections[1].elements.length, 2, '`[1 2]` keeps both elements across the missing comma');
});
