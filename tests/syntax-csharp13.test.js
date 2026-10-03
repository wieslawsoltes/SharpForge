import test from 'node:test';
import assert from 'node:assert/strict';
import { boundPhaseCodes, languageFeature } from '@sharpforge/syntax';
import {
  assertGatesMatchRoslyn,
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  classMembersOf,
  diagnosticsOf,
  expressionOf,
  shapeOf
} from './support/syntax-reference.js';

// SF-A01-T50: C# 13 params collections, allows ref struct and implicit index initializers.
test('T50 params collections, allows ref struct and ^ index initializers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp13-14/csharp13.cs');
  for (const kind of ['AllowsConstraintClause', 'RefStructConstraint', 'ImplicitElementAccess', 'IndexExpression', 'Parameter']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const allows = [...tree.root.descendantTokens()].filter(token => token.text === 'allows');
  assert.equal(allows.filter(token => token.kind === 'AllowsKeyword').length, 6);
  assert.equal(allows.filter(token => token.kind === 'IdentifierToken').length, 3, '`allows` stays an identifier outside constraints');
});

test('T50 params takes any parameter type; the syntax is that of a params array', () => {
  const [array, list, span] = classMembersOf('void A(params int[] xs) { } void B(params List<int> xs) { } void D(int a, params Span<int> xs) { }');
  assert.equal(shapeOf(array.parameterList.parameters[0].type), 'ArrayType(PredefinedType(int) ArrayRankSpecifier([ OmittedArraySizeExpression() ]))');
  assert.equal(list.parameterList.parameters[0].modifiers[0].kind, 'ParamsKeyword');
  assert.equal(list.parameterList.parameters[0].type.kind, 'GenericName');
  assert.equal(span.parameterList.parameters[1].modifiers[0].kind, 'ParamsKeyword');
});

test('T50 allows ref struct is an anti-constraint that follows the other constraints', () => {
  const [method] = classMembersOf('void T<T1, T2>() where T1 : allows ref struct where T2 : class, new(), allows ref struct { }');
  assert.equal(shapeOf(method.constraintClauses[0].constraints[0]), 'AllowsConstraintClause(allows RefStructConstraint(ref struct))');
  assert.deepEqual(
    method.constraintClauses[1].constraints.map(constraint => constraint.kind),
    ['ClassConstraint', 'ConstructorConstraint', 'AllowsConstraintClause']
  );
});

test('T50 [^1] = v is an index initializer whose key is an index expression', () => {
  const initializer = expressionOf('new Buffer { [^1] = 1, [0] = 2, [1..] = 3 }').initializer;
  assert.equal(initializer.kind, 'ObjectInitializerExpression');
  assert.deepEqual(
    initializer.expressions.map(assignment => assignment.left.argumentList.arguments[0].expression.kind),
    ['IndexExpression', 'NumericLiteralExpression', 'RangeExpression']
  );
  // Whether the indexer is an implicit Index indexer is a binding question, so the parser has no gate for it.
  assert.equal(languageFeature('ImplicitIndexerInitializer').version, 13);
  assert.deepEqual(diagnosticsOf('class C { void M() { var a = new Buffer { [^1] = 1 }; } }', '12'), []);
});

test('T50 the 13.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp13.rejected.cs');
  assert.equal(agreed.length, 13);
  assert.deepEqual(diagnosticsOf('class C { void B(params List<int> xs) { } }', '12'), ['CS9202@17 "params List<int> xs"']);
  assert.deepEqual(diagnosticsOf('class C { void A(params int[] xs) { } void H(params int[][] ys) { } }', '1'), [], 'params arrays are C# 1');
  assert.deepEqual(diagnosticsOf('class G<T> where T : allows ref struct { }', '12'), ['CS9202@28 "ref struct"']);
  assert.deepEqual(diagnosticsOf('class C { void B(params List<int> xs) { } } class G<T> where T : allows ref struct { }', '13'), []);
});

test('T50 malformed params and allows clauses recover as Roslyn does', () => {
  assert(boundPhaseCodes.has('CS1107'), 'Roslyn reports a repeated parameter modifier while binding');
  assertRecoversLikeRoslyn('reference/csharp13-14/csharp13-recovery.cs');
});
