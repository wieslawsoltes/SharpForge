import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: in `(var x, var (y, z)) = e` the nested `var (y, z)` must be a
// declaration expression with a parenthesised designation, not a call to a method named var.
test('nested var designations in deconstructions match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/nested-designations.cs');
  assert(kinds.has('ParenthesizedVariableDesignation'));
  assert.deepEqual(tree.getDiagnostics(), []);
  const { tree: topLevel } = assertMatchesRoslyn('reference/csharp7/nested-designations-top-level.cs');
  assert.deepEqual(topLevel.getDiagnostics(), []);
});

test('`(var x, var (y, z)) = t` declares x, y and z', () => {
  const [statement] = statementsOf('(var x, var (y, z)) = t;');
  assert.equal(
    shapeOf(statement.expression.left),
    'TupleExpression(( Argument(DeclarationExpression(IdentifierName(var) SingleVariableDesignation(x))) , ' +
      'Argument(DeclarationExpression(IdentifierName(var) ' +
      'ParenthesizedVariableDesignation(( SingleVariableDesignation(y) , SingleVariableDesignation(z) )))) ))'
  );
  assert(![...statement.descendantNodes()].some(node => node.kind === 'InvocationExpression'));
});

test('the nested form works at every depth and position, and with a predefined type', () => {
  const kindsOf = text => statementsOf(text)[0].expression.left.arguments.map(argument => argument.expression.kind);
  assert.deepEqual(kindsOf('(var (i, j), var k) = t;'), ['DeclarationExpression', 'DeclarationExpression']);
  assert.deepEqual(kindsOf('(var a, (var b, var (c, d))) = t;'), ['DeclarationExpression', 'TupleExpression']);
  assert.deepEqual(kindsOf('(int e, var (f, (g, h))) = t;'), ['DeclarationExpression', 'DeclarationExpression']);
  assert.deepEqual(kindsOf('(var (l, m), n) = t;'), ['DeclarationExpression', 'IdentifierName']);
  const [each] = statementsOf('foreach ((var r, var (s, u)) in ts) { }');
  assert.equal(each.kind, 'ForEachVariableStatement');
  assert.equal(each.variable.arguments[1].expression.designation.kind, 'ParenthesizedVariableDesignation');
});

test('var(...) is still a call where no designation can stand', () => {
  const [call, single] = statementsOf('F(var (a1, b1)); (var(c1, d1)) = t;');
  assert.equal(call.expression.argumentList.arguments[0].expression.kind, 'InvocationExpression', 'an ordinary argument is not a declaration');
  assert.equal(single.expression.left.kind, 'ParenthesizedExpression', 'a single parenthesised element is not a tuple');
  assert.deepEqual(diagnosticsOf('class C { void M() { (var x, var (y, z)) = t; } }', '7'), []);
});
