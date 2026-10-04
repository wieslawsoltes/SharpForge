import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MakeRefExpressionSyntax,
  RefTypeExpressionSyntax,
  RefValueExpressionSyntax
} from '@sharpforge/syntax';
import {
  expressionOf
} from './support/syntax-reference.js';

test('T02.9 typed-reference syntax preserves native operand and type child roles', () => {
  const make = expressionOf('__makeref(value)'),
    type = expressionOf('__reftype(reference)');
  const value = expressionOf('__refvalue(reference, System.Int32)');
  assert(make instanceof MakeRefExpressionSyntax);
  assert(type instanceof RefTypeExpressionSyntax);
  assert(value instanceof RefValueExpressionSyntax);
  assert.equal(make.expression.identifier.valueText, 'value');
  assert.equal(type.expression.identifier.valueText, 'reference');
  assert.equal(value.type.kind, 'QualifiedName');
  assert.equal(value.type.right.identifier.valueText, 'Int32');
  assert.equal(value.comma.text, ',');
  assert.equal(value.withExpression(make.expression).expression.identifier.valueText, 'value');
});
