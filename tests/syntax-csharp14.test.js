import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGatesMatchRoslyn,
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  diagnosticsOf,
  expressionOf,
  shapeOf,
  statementsOf
} from './support/syntax-reference.js';

// SF-A01-T52: C# 14 null-conditional assignment, unbound nameof and modified simple lambda parameters.
const inMethod = body => `class C { void M() { ${body} } }`;

test('T52 null-conditional assignment, unbound nameof and lambda parameter modifiers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp13-14/csharp14.cs');
  for (const kind of ['ConditionalAccessExpression', 'OmittedTypeArgument', 'ParenthesizedLambdaExpression', 'CoalesceAssignmentExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T52 a?.b = c assigns inside the conditional access', () => {
  const [simple, compound, chained] = statementsOf('a?.b = c; a?.b += 1; a?.b?.c = d;');
  assert.equal(
    shapeOf(simple.expression),
    'ConditionalAccessExpression(IdentifierName(a) ? SimpleAssignmentExpression(MemberBindingExpression(. IdentifierName(b)) = IdentifierName(c)))'
  );
  assert.equal(compound.expression.whenNotNull.kind, 'AddAssignmentExpression');
  assert.equal(chained.expression.whenNotNull.whenNotNull.kind, 'SimpleAssignmentExpression', 'the assignment belongs to the innermost access');
  const [element, rightAssociative] = statementsOf('a?[0] = c; a?.b = c = d;');
  assert.equal(element.expression.whenNotNull.left.kind, 'ElementBindingExpression');
  assert.equal(rightAssociative.expression.whenNotNull.right.kind, 'SimpleAssignmentExpression');
  assert.equal(expressionOf('x = a?.b = c').right.kind, 'ConditionalAccessExpression');
});

test('T52 nameof takes an unbound generic type', () => {
  assert.equal(
    shapeOf(expressionOf('nameof(List<>)').argumentList.arguments[0].expression),
    'GenericName(List TypeArgumentList(< OmittedTypeArgument() >))'
  );
  const members = expressionOf('nameof(Dictionary<,>.Keys)').argumentList.arguments[0].expression;
  assert.equal(members.kind, 'SimpleMemberAccessExpression');
  assert.equal(members.expression.typeArgumentList.arguments.length, 2);
});

test('T52 implicitly typed lambda parameters take modifiers', () => {
  const [byRef, byOut] = expressionOf('(ref x, out y) => { y = x; }').parameterList.parameters;
  assert.equal(shapeOf(byRef), 'Parameter(ref x)');
  assert.equal(byOut.type, null);
  assert.equal(byOut.modifiers[0].kind, 'OutKeyword');
  assert.equal(shapeOf(expressionOf('(scoped ref x) => x').parameterList.parameters[0]), 'Parameter(scoped ref x)');
  assert.equal(shapeOf(expressionOf('(scoped x) => x').parameterList.parameters[0]), 'Parameter(scoped x)');
  assert.equal(expressionOf('(ref int x) => x').parameterList.parameters[0].type.kind, 'PredefinedType', 'explicitly typed parameters are unchanged');
});

test('T52 the 14.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp14.rejected.cs');
  assert.equal(agreed.length, 10, 'five assignments, three unbound names and two modified parameters');
  assert.deepEqual(diagnosticsOf(inMethod('a?.b = c;'), '13'), ['CS9260@26 "="']);
  assert.deepEqual(diagnosticsOf(inMethod('a?.b += 1;'), '13'), ['CS9260@26 "+="']);
  assert.deepEqual(diagnosticsOf(inMethod('var n = nameof(List<>);'), '13'), ['CS9260@36 "List<>"']);
  assert.deepEqual(diagnosticsOf(inMethod('var n = nameof(List<int>); var t = typeof(List<>);'), '13'), [], 'bound names and typeof are older');
  assert.deepEqual(diagnosticsOf(inMethod('F((text, out result) => true);'), '13'), ['CS9260@30 "out result"']);
  assert.deepEqual(diagnosticsOf(inMethod('F((ref int x) => x);'), '13'), []);
  assert.deepEqual(diagnosticsOf(inMethod('a?.b = c; var n = nameof(List<>); F((ref x) => x);'), '14'), []);
});

test('T52 malformed forms recover as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp13-14/csharp14-recovery.cs');
});
