import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, codesOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T24: C# 3 object, collection and nested initializers.
test('T24 object, collection and nested initializers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp3-5/initializers.cs');
  for (const kind of ['ObjectInitializerExpression', 'CollectionInitializerExpression', 'ComplexElementInitializerExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T24 nested member initializers and multi-argument collection elements have structured nodes', () => {
  assert.equal(
    shapeOf(expressionOf('new Line { Start = { X = 1 }, End = new Point { X = 3 } }').initializer),
    'ObjectInitializerExpression({ ' +
      'SimpleAssignmentExpression(IdentifierName(Start) = ObjectInitializerExpression({ ' +
      'SimpleAssignmentExpression(IdentifierName(X) = NumericLiteralExpression(1)) })) , ' +
      'SimpleAssignmentExpression(IdentifierName(End) = ObjectCreationExpression(new IdentifierName(Point) ObjectInitializerExpression({ ' +
      'SimpleAssignmentExpression(IdentifierName(X) = NumericLiteralExpression(3)) }))) })'
  );
  assert.equal(
    shapeOf(expressionOf('new D { { "a", 1 }, { "b", 2 } }').initializer),
    'CollectionInitializerExpression({ ' +
      'ComplexElementInitializerExpression({ StringLiteralExpression("a") , NumericLiteralExpression(1) }) , ' +
      'ComplexElementInitializerExpression({ StringLiteralExpression("b") , NumericLiteralExpression(2) }) })'
  );
  const nested = expressionOf('new Outer { Items = { 1, 2 }, Map = { { 1, "x" } } }').initializer.expressions;
  assert.deepEqual(
    nested.map(assignment => assignment.right.kind),
    ['CollectionInitializerExpression', 'CollectionInitializerExpression']
  );
  assert.equal(expressionOf('new Point { }').initializer.kind, 'ObjectInitializerExpression', 'an empty initializer is an object initializer');
});

test('T24 initializers work on any type, not only registered ones', () => {
  for (const type of ['Point', 'N.M.Point', 'global::N.Point', 'List<int>', 'Dictionary<string, List<int>>', 'Outer.Inner<T>']) {
    const creation = expressionOf(`new ${type} { A = 1 }`);
    assert.equal(creation.kind, 'ObjectCreationExpression', type);
    assert.equal(creation.initializer.kind, 'ObjectInitializerExpression', type);
    assert.equal(expressionOf(`new ${type}(1) { 1, 2 }`).initializer.kind, 'CollectionInitializerExpression', type);
  }
});

test('T24 the legacy adapter still gives the compiler its Initializer nodes', () => {
  const legacy = parse('class P { public int X; } class C { void M() { var p = new P { X = 1 }; } }');
  assert.deepEqual(legacy.diagnostics, []);
  const creation = legacy.root.members[1].members[0].body.statements[0].declarations[0].initializer;
  assert.equal(creation.kind, 'New');
  assert.deepEqual(
    creation.initializers.map(initializer => [initializer.kind, initializer.name]),
    [['Initializer', 'X']]
  );
});

test('T24 initializers are rejected below C# 3 and recover as Roslyn does', () => {
  const source = 'class C { void M() { object a = new P { X = 1 }; object b = new L { 1, 2 }; } }';
  assert.deepEqual(codesOf(source, '2'), ['CS8023', 'CS8023']);
  assert.deepEqual(codesOf(source, '3'), []);
  const { tree } = assertRecoversLikeRoslyn('reference/csharp3-5/initializers-recovery.cs');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS1525', 'CS1003', 'CS1525', 'CS1525', 'CS1002', 'CS1513']
  );
});
