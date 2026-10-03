import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, codesOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T26: C# 3 extension-method `this` parameters, auto-properties and partial methods; C# 4 default values.
test('T26 this parameters, default values, auto-properties and partial methods match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp3-5/parameters.cs');
  for (const kind of ['ParameterList', 'BracketedParameterList', 'Parameter', 'EqualsValueClause', 'AccessorList']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T26 the this modifier and default values are parts of the parameter node', () => {
  const [method] = classMembersOf('static void A(this ref int x, int y = 1, params int[] rest) { }');
  assert.equal(
    shapeOf(method.parameterList),
    'ParameterList(( Parameter(this ref PredefinedType(int) x) , ' +
      'Parameter(PredefinedType(int) y EqualsValueClause(= NumericLiteralExpression(1))) , ' +
      'Parameter(params ArrayType(PredefinedType(int) ArrayRankSpecifier([ OmittedArraySizeExpression() ])) rest) ))'
  );
  const [indexer, constructor] = classMembersOf('int this[int i, int j = 0] { get { return 0; } } C(int a = 0) { }');
  assert.equal(indexer.parameterList.kind, 'BracketedParameterList');
  assert.equal(indexer.parameterList.parameters[1].default.value.kind, 'NumericLiteralExpression');
  assert.equal(constructor.parameterList.parameters[0].default.kind, 'EqualsValueClause');
});

test('T26 accessors may have semicolon bodies and partial methods may have no body', () => {
  const [auto, defining, implementing] = classMembersOf('public int P { get; private set; } partial void M(int a); partial void M(int a) { }');
  assert.deepEqual(
    auto.accessorList.accessors.map(accessor => [accessor.keyword.text, !!accessor.semicolonToken, !!accessor.body]),
    [
      ['get', true, false],
      ['set', true, false]
    ]
  );
  assert.deepEqual(
    [defining, implementing].map(method => [method.modifiers[0].kind, !!method.body, !!method.semicolonToken]),
    [
      ['PartialKeyword', false, true],
      ['PartialKeyword', true, false]
    ]
  );
});

test('T26 each form is rejected below its language version', () => {
  assert.deepEqual(codesOf('static class E { static void A(this int x) { } }', '2'), ['CS8023']);
  assert.deepEqual(codesOf('static class E { static void A(this int x) { } }', '3'), []);
  assert.deepEqual(codesOf('partial class E { partial void A(); }', '2'), ['CS8023']);
  assert.deepEqual(codesOf('partial class E { partial void A(); }', '3'), []);
  assert.deepEqual(codesOf('class E { void A(int x = 1) { } }', '3'), ['CS8024']);
  assert.deepEqual(codesOf('class E { void A(int x = 1) { } }', '4'), []);
});

test('T26 malformed parameter lists recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp3-5/parameters-recovery.cs');
  const missingComma = tree.getDiagnostics().find(diagnostic => diagnostic.code === 'CS1003');
  assert.equal(tree.toFullString().slice(missingComma.start, missingComma.start + 5), 'int b', 'a missing comma is reported at the next parameter');
});
