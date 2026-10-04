/** Conversion and coalescing factory shapes, including lifted user conversions (SF-A02-T07.5). */
import { isNullableType, stripNullable } from '../conversions/nullable.js';
import { isCheckedOperatorName } from '../overload/checked-operators.js';

const sameType = (left, right) => left === right || !!left?.equals(right);

/** A standard conversion between already visited operands; explicit identity casts remain visible. */
export function convertTree(builder, operand, type, { isChecked = false, method = null, force = false } = {}) {
  if (!method && !force && sameType(operand.type, type)) return operand;
  return builder.node(isChecked ? 'ConvertChecked' : 'Convert', type, { operands: [operand], method });
}

/** A user conversion may need a standard conversion before and after its operator method. */
function userConversion(builder, operand, type, conversion, isChecked) {
  const method = conversion.method,
    input = method.parameters[0].type,
    stripped = stripNullable(operand.type),
    lifted = !sameType(operand.type, input) && sameType(stripped, input),
    expected = conversion.kind === 'ExplicitUserDefined' ? input : stripNullable(input),
    argument = sameType(stripped, expected) ? operand : convertTree(builder, operand, input, { isChecked }),
    resultType = lifted && method.returnType.isValueType && !isNullableType(method.returnType) && isNullableType(type)
      ? builder.core.nullableOf(method.returnType)
      : method.returnType;
  const result = convertTree(builder, argument, resultType, { method, isChecked: isChecked && isCheckedOperatorName(method.name) });
  return convertTree(builder, result, type, { isChecked });
}

function conversion(node) {
  const kind = node.conversion?.kind;
  if (kind === 'AnonymousFunction') return this.nestedLambda(node);
  if (kind === 'MethodGroup') this.fail('a method group conversion', node);
  if (kind === 'DefaultLiteral') return this.node('Constant', node.type, { isDefault: true });
  if (kind === 'NullLiteral') return this.constant(null, node.type);
  if (kind === 'InterpolatedString') return this.visit(node.operand);
  const operand = this.visit(node.operand);
  if (kind === 'Identity' || kind === 'ImplicitReference')
    return node.isExplicit ? convertTree(this, operand, node.type, { force: true }) : operand;
  if (node.conversion?.method && (node.conversion.isUserDefined || kind === 'IntPtr'))
    return userConversion(this, operand, node.type, node.conversion, !!node.isChecked);
  if (kind === 'ImplicitNullable' && !isNullableType(node.operand.type)) {
    const intermediate = convertTree(this, operand, stripNullable(node.type), { isChecked: !!node.isChecked });
    return convertTree(this, intermediate, node.type, { isChecked: !!node.isChecked });
  }
  return convertTree(this, operand, node.type, { isChecked: !!node.isChecked, force: !!node.isExplicit });
}

function conditional(node) {
  // Unlike a call argument or lambda result, both branches must have exactly the conditional's result type.
  const exact = branch => this.visit(branch.kind === 'Conversion' ? { ...branch, isExplicit: true } : branch);
  return this.node('Condition', node.type, { operands: [this.visit(node.condition), exact(node.whenTrue), exact(node.whenFalse)] }, 'Conditional');
}

function coalesce(node) {
  if (node.right.form === 'throw') this.fail('a throw expression', node.right);
  const operands = [this.visit(node.left), this.visit(node.right)];
  if (!node.leftConversion?.isUserDefined) return this.node('Coalesce', node.type, { operands });
  const parameter = this.node('Parameter', stripNullable(node.left.type), { name: 'p' }),
    body = userConversion(this, parameter, node.type, node.leftConversion, !!node.isChecked),
    conversion = this.node('Lambda', null, { body, parameters: [parameter] });
  return this.node('Coalesce', node.type, { operands, conversion });
}

/** Bound node kind -> visitor, called with the tree builder as `this`. */
export const expressionTreeConversionVisitors = Object.freeze({ Conversion: conversion, Conditional: conditional, Coalesce: coalesce });
