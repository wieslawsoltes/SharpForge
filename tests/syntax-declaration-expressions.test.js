import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T32: C# 7.0 out variable declarations and discards.
test('T32 out variables, discards and designations match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/declaration-expressions.cs');
  for (const kind of ['DeclarationExpression', 'SingleVariableDesignation', 'DiscardDesignation', 'ParenthesizedVariableDesignation'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T32 `out var x`, `out T x` and `out var _` are declaration expressions', () => {
  assert.equal(
    shapeOf(expressionOf('F(out var x)').argumentList.arguments[0]),
    'Argument(out DeclarationExpression(IdentifierName(var) SingleVariableDesignation(x)))'
  );
  assert.equal(
    shapeOf(expressionOf('F(out int y, out _, out var _)').argumentList),
    'ArgumentList(( Argument(out DeclarationExpression(PredefinedType(int) SingleVariableDesignation(y))) , ' +
      'Argument(out IdentifierName(_)) , ' +
      'Argument(out DeclarationExpression(IdentifierName(var) DiscardDesignation(_))) ))'
  );
  assert.equal(expressionOf('F(out List<int>[] z)').argumentList.arguments[0].expression.type.kind, 'ArrayType');
  assert.equal(expressionOf('t[out var i]').argumentList.arguments[0].expression.kind, 'DeclarationExpression', 'also in an element access');
});

test('T32 an out argument that is not a type followed by a name stays an expression', () => {
  assert.equal(expressionOf('F(out a.b)').argumentList.arguments[0].expression.kind, 'SimpleMemberAccessExpression');
  assert.equal(expressionOf('F(out a[0])').argumentList.arguments[0].expression.kind, 'ElementAccessExpression');
  assert.equal(expressionOf('F(out x)').argumentList.arguments[0].expression.kind, 'IdentifierName');
  assert.equal(expressionOf('F(out var (u, v))').argumentList.arguments[0].expression.kind, 'InvocationExpression', 'no tuple designation after out');
});

test('T32 discards in assignments and deconstructions', () => {
  const [assign, tuple, declared] = statementsOf('_ = F(); (_, var b) = t; var (_, c) = t;');
  assert.equal(shapeOf(assign.expression.left), 'IdentifierName(_)');
  assert.equal(tuple.expression.left.arguments[1].expression.kind, 'DeclarationExpression');
  assert.equal(
    shapeOf(declared.expression.left),
    'DeclarationExpression(IdentifierName(var) ParenthesizedVariableDesignation(( DiscardDesignation(_) , SingleVariableDesignation(c) )))'
  );
});

test('T32 out variables are rejected below C# 7', () => {
  assert.deepEqual(diagnosticsOf('class C { void M() { F(out var x); } }', '6'), ['CS8059@23 "out"']);
  assert.deepEqual(diagnosticsOf('class C { void M() { F(out var x); } }', '7'), []);
  assert.deepEqual(diagnosticsOf('class C { void M() { F(out x); F(out _); } }', '6'), [], 'a plain out argument is C# 1');
});

test('T32 malformed out arguments recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp7/declaration-expressions-recovery.cs');
  const declarations = [...tree.root.descendantNodes()].filter(node => node.kind === 'DeclarationExpression');
  assert.equal(declarations.length, 2, '`out var x y` and an unterminated `out var x` still declare x');
});
