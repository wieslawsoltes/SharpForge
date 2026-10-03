import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, codesOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T25: C# 3 anonymous object creation and implicitly typed arrays.
test('T25 anonymous objects and implicitly typed arrays match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp3-5/anonymous-objects.cs');
  for (const kind of ['AnonymousObjectCreationExpression', 'AnonymousObjectMemberDeclarator', 'NameEquals', 'ImplicitArrayCreationExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T25 anonymous object members are named or projected', () => {
  assert.equal(
    shapeOf(expressionOf('new { A = 1, b.C }')),
    'AnonymousObjectCreationExpression(new { ' +
      'AnonymousObjectMemberDeclarator(NameEquals(IdentifierName(A) =) NumericLiteralExpression(1)) , ' +
      'AnonymousObjectMemberDeclarator(SimpleMemberAccessExpression(IdentifierName(b) . IdentifierName(C))) })'
  );
  assert.deepEqual(
    expressionOf('new { x, y.z, W = 1, }').initializers.map(member => !!member.nameEquals),
    [false, false, true]
  );
  assert.equal(expressionOf('new { }').initializers.length, 0);
});

test('T25 implicitly typed arrays keep their rank commas and nested initializers', () => {
  assert.equal(
    shapeOf(expressionOf('new[,] { { 1 } }')),
    'ImplicitArrayCreationExpression(new [ , ] ArrayInitializerExpression({ ArrayInitializerExpression({ NumericLiteralExpression(1) }) }))'
  );
  assert.equal(expressionOf('new[] { 1, 2 }').commas.length, 0);
  assert.equal(expressionOf('new[,,] { }').commas.length, 2);
  assert.equal(expressionOf('new[] { new[] { 1 } }').initializer.expressions[0].kind, 'ImplicitArrayCreationExpression');
});

test('T25 both forms are rejected below C# 3 and recover as Roslyn does', () => {
  const source = 'class C { void M() { object a = new { A = 1 }; object b = new[] { 1 }; } }';
  assert.deepEqual(codesOf(source, '2'), ['CS8023', 'CS8023']);
  assert.deepEqual(codesOf(source, '3'), []);
  assertRecoversLikeRoslyn('reference/csharp3-5/anonymous-objects-recovery.cs');
});
