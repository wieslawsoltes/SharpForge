import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T29: C# 6 expression-bodied members and auto-property initializers; C# 7 expression-bodied accessors,
// constructors and destructors.
test('T29 expression bodies and auto-property initializers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp6/expression-bodies.cs');
  for (const kind of ['ArrowExpressionClause', 'EqualsValueClause', 'RefExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const withArrow = new Set(
    [...tree.root.descendantNodes()].filter(node => node.kind === 'ArrowExpressionClause').map(node => node.parent.kind)
  );
  assert.deepEqual(
    [...withArrow].sort(),
    [
      'AddAccessorDeclaration',
      'ConstructorDeclaration',
      'ConversionOperatorDeclaration',
      'DestructorDeclaration',
      'GetAccessorDeclaration',
      'IndexerDeclaration',
      'LocalFunctionStatement',
      'MethodDeclaration',
      'OperatorDeclaration',
      'PropertyDeclaration',
      'RemoveAccessorDeclaration',
      'SetAccessorDeclaration'
    ]
  );
});

test('T29 an expression body replaces the block or the accessor list', () => {
  const [method, property, indexer, auto, getterOnly] = classMembersOf(
    'int M() => 1; int P => 2; int this[int i] => i; int A { get; set; } = 3; int R { get; }'
  );
  assert.equal(shapeOf(method.expressionBody), 'ArrowExpressionClause(=> NumericLiteralExpression(1))');
  assert.equal(method.body, null);
  assert.equal(property.accessorList, null);
  assert.equal(shapeOf(property.expressionBody), 'ArrowExpressionClause(=> NumericLiteralExpression(2))');
  assert.equal(indexer.accessorList, null);
  assert.equal(indexer.expressionBody.expression.kind, 'IdentifierName');
  assert.equal(shapeOf(auto.initializer), 'EqualsValueClause(= NumericLiteralExpression(3))');
  assert.equal(auto.semicolonToken.text, ';');
  assert.deepEqual(
    getterOnly.accessorList.accessors.map(accessor => accessor.kind),
    ['GetAccessorDeclaration']
  );
  assert.equal(getterOnly.initializer, null);
});

test('T29 methods, properties, indexers, operators and initializers need C# 6', () => {
  const source = 'class C { int M() => 1; int P => 1; int this[int i] => i; public static C operator +(C a, C b) => a; int A { get; } = 1; }';
  assert.deepEqual(diagnosticsOf(source, '5'), ['CS8026@18 "=>"', 'CS8026@30 "=>"', 'CS8026@52 "=>"', 'CS8026@95 "=>"', 'CS8026@116 "="']);
  assert.deepEqual(diagnosticsOf(source, '6'), []);
});

test('T29 accessors, constructors and destructors need C# 7', () => {
  const source = 'class C { int x; C() => x = 1; ~C() => x = 0; int A { get => x; set => x = value; } int M() => 1; }';
  assert.deepEqual(diagnosticsOf(source, '6'), ['CS8059@21 "=>"', 'CS8059@36 "=>"', 'CS8059@58 "=>"', 'CS8059@68 "=>"']);
  assert.deepEqual(diagnosticsOf(source, '7'), []);
});

test('T29 a missing expression or semicolon recovers as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp6/expression-bodies-recovery.cs');
  assert.equal(tree.root.members[0].members.length, 7, 'every member survives');
});
