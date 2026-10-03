import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import {
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  diagnosticsOf,
  expressionOf,
  shapeOf,
  statementsOf
} from './support/syntax-reference.js';

// SF-A01-T30: C# 6 using static, exception filters and index initializers.
test('T30 using static, exception filters and index initializers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp6/csharp6.cs');
  for (const kind of ['UsingDirective', 'CatchFilterClause', 'ImplicitElementAccess', 'ObjectInitializerExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  assert.deepEqual(
    tree.root.usings.map(using => using.staticKeyword?.text ?? null),
    ['static', 'static', 'static', 'static']
  );
  const whens = [...tree.root.descendantTokens()].filter(token => token.text === 'when');
  assert.equal(whens.filter(token => token.kind === 'WhenKeyword').length, 4);
  assert(whens.filter(token => token.kind === 'IdentifierToken').length >= 4, '`when` stays an identifier outside catch clauses');
});

test('T30 using static keeps its target as a name', () => {
  const [using] = SyntaxTree.parseText('using static System.Math;').root.usings;
  assert.equal(shapeOf(using), 'UsingDirective(using static QualifiedName(IdentifierName(System) . IdentifierName(Math)) ;)');
});

test('T30 an exception filter follows a catch declaration or a general catch', () => {
  const [typed, general] = statementsOf('try { } catch (E e) when (e != null) { } try { } catch when (true) { }');
  assert.equal(
    shapeOf(typed.catches[0].filter),
    'CatchFilterClause(when ( NotEqualsExpression(IdentifierName(e) != NullLiteralExpression(null)) ))'
  );
  assert.equal(general.catches[0].declaration, null);
  assert.equal(general.catches[0].filter.filterExpression.kind, 'TrueLiteralExpression');
});

test('T30 index initializers are members of an object initializer', () => {
  assert.equal(
    shapeOf(expressionOf('new D { ["a"] = 1 }').initializer),
    'ObjectInitializerExpression({ SimpleAssignmentExpression(' +
      'ImplicitElementAccess(BracketedArgumentList([ Argument(StringLiteralExpression("a")) ])) = NumericLiteralExpression(1)) })'
  );
  const nested = expressionOf('new T { [0] = { X = 1 }, P = { [1, 2] = 3 } }').initializer.expressions;
  assert.equal(nested[0].right.kind, 'ObjectInitializerExpression');
  assert.equal(nested[1].right.expressions[0].left.argumentList.arguments.length, 2);
});

test('T30 an initializer is an object initializer when it is empty or holds an assignment, as in Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp6/initializer-kinds.cs');
  assert.deepEqual(
    [...tree.root.descendantNodes()].filter(node => /^(Object|Collection)Initializer/.test(node.kind)).map(node => node.kind),
    ['ObjectInitializerExpression', 'ObjectInitializerExpression', 'ObjectInitializerExpression', 'ObjectInitializerExpression']
  );
  assert.equal(expressionOf('new T { 1, 2 }').initializer.kind, 'CollectionInitializerExpression');
  assert.equal(expressionOf('new T { { 1, 2 } }').initializer.kind, 'CollectionInitializerExpression');
});

test('T30 LangVersion 5 rejects each form', () => {
  assert.deepEqual(diagnosticsOf('using static System.Math; class C { }', '5'), ['CS8026@6 "static"']);
  assert.deepEqual(diagnosticsOf('class C { void M() { try { } catch (E e) when (e != null) { } } }', '5'), ['CS8026@41 "when"']);
  assert.deepEqual(diagnosticsOf('class C { void M() { var a = new D { ["a"] = 1 }; } }', '5'), ['CS8026@37 "["']);
  for (const source of [
    'using static System.Math; class C { }',
    'class C { void M() { try { } catch (E e) when (e != null) { } } }',
    'class C { void M() { var a = new D { ["a"] = 1 }; } }'
  ])
    assert.deepEqual(diagnosticsOf(source, '6'), [], source);
});

test('T30 malformed forms recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp6/csharp6-recovery.cs');
  const filters = [...tree.root.descendantNodes()].filter(node => node.kind === 'CatchFilterClause');
  assert.equal(filters.length, 4, 'a filter is kept even when its parentheses or condition are missing');
  assert(tree.getDiagnostics().some(diagnostic => diagnostic.code === 'CS0443'), 'an empty index initializer key reports CS0443');
});
