import {Builtins} from '@sharpforge/bytecode';
import {frameworkType} from '@sharpforge/framework';
import {numeric, integral, unaryPromotion, binaryPromotion, scalarLiteral, constantValue, numericDefault} from '../numeric.js';
import {negativeMinimum, scalarConditionalType} from '../scalar-expressions.js';
import {scalarBuiltinFor, scalarType, scalarStringBuiltin} from '../scalar-queries.js';
import {bindArrayBuiltin} from '../array-builtins.js';
import {BoundLiteral, BoundCall, BoundConversion, BoundUnaryOperator, BoundBinaryOperator,
  BoundIncrementOperator, BoundCompoundAssignmentOperator, BoundConditionalOperator} from '../bound/nodes.js';

function conversion(binder, operand, target, checked = false) {
  if (operand.legacyType === target) return operand;
  return binder.node(BoundConversion, operand.syntax, {
    operand, conversion: {kind: 'ImplicitNumeric', from: operand.legacyType, to: target}, isExplicit: false, isChecked: checked,
  }, target);
}

export function bindScalarTyped(binder, syntax, target) {
  if (!numeric(target)) return undefined;
  if (syntax?.kind === 'Conditional') return bindConditional(binder, syntax, target);
  const value = binder.bindExpression(syntax);
  if (numeric(value.legacyType) && binder.scalarAccepts(syntax, target, value.legacyType)) return conversion(binder, value, target);
  return value;
}

function bindConditional(binder, syntax, type) {
  const condition = binder.bindBool(syntax.condition);
  const consequence = binder.bindTyped(syntax.whenTrue, type), alternative = binder.bindTyped(syntax.whenFalse, type);
  binder.checkAssign(type, consequence.legacyType, syntax.whenTrue);
  binder.checkAssign(type, alternative.legacyType, syntax.whenFalse);
  return binder.node(BoundConditionalOperator, syntax, {condition, consequence, alternative}, type);
}

function stringCall(binder, value) {
  const intrinsic = scalarStringBuiltin(value.legacyType);
  return binder.node(BoundCall, value.syntax, {receiver: null, method: binder.sym.builtin(intrinsic), args: [value], intrinsic}, 'string');
}

function bindProfile(binder, syntax, binding, profile) {
  if (binding.error) return binder.bad(syntax);
  const intrinsic = profile === 'array' ? Builtins.find(item => item?.arrayRuntime === binding.descriptor) : scalarBuiltinFor(binding.descriptor);
  const receiver = binding.receiver ? binder.bindExpression(binding.receiver) : null;
  const parameters = binding.descriptor.parameters;
  const args = (binding.arguments ?? syntax.args ?? []).map((argument, index) => {
    const target = scalarType(parameters[index]);
    if (target.endsWith('&')) return binder.bindAddressArgument(argument, target);
    if (target === 'System.Array' || target === 'object') return binder.bindExpression(argument);
    const value = binder.bindTyped(argument, target);
    binder.checkAssign(target, value.legacyType, argument);
    return value;
  });
  return binder.node(BoundCall, syntax, {receiver, method: binder.sym.builtin(intrinsic), args, intrinsic}, binding.result);
}

function bindBinary(binder, syntax) {
  const leftType = binder.infer(syntax.left), rightType = binder.infer(syntax.right);
  if (!numeric(leftType) && !numeric(rightType)) return undefined;
  let left = binder.bindExpression(syntax.left), right = binder.bindExpression(syntax.right);
  if (syntax.operator === '+' && (leftType === 'string' || rightType === 'string')) {
    if (numeric(leftType)) left = stringCall(binder, left);
    if (numeric(rightType)) right = stringCall(binder, right);
    return binder.node(BoundBinaryOperator, syntax, {
      operator: '+', left, right, isChecked: false, method: null, negate: false,
    }, 'string');
  }
  if (syntax.operator === '>>>') binder.c.requireFeature(syntax, 11, 'Unsigned right shift');
  const promoted = binaryPromotion(leftType, rightType, syntax.operator, binder.constant(syntax.left), binder.constant(syntax.right));
  if (!promoted || ['&', '|', '^', '<<', '>>', '>>>'].includes(syntax.operator) && !integral(promoted)) {
    binder.c.report(syntax, 'CS0019', [syntax.operator, leftType, rightType]);
    return binder.bad(syntax, [left, right]);
  }
  left = conversion(binder, left, promoted);
  right = conversion(binder, right, ['<<', '>>', '>>>'].includes(syntax.operator) ? 'int' : promoted);
  const type = ['==', '!=', '<', '>', '<=', '>='].includes(syntax.operator) ? 'bool' : promoted;
  const folded = binder.constant(syntax);
  return binder.node(BoundBinaryOperator, syntax, {
    operator: syntax.operator, left, right, isChecked: binder.overflowChecked(syntax), method: null, negate: false,
  }, type, folded ? {constantValue: {value: folded.value}} : null);
}

function bindUnary(binder, syntax) {
  const minimum = negativeMinimum(syntax);
  if (minimum) return binder.node(BoundLiteral, syntax, {value: minimum.value}, minimum.type, {constantValue: {value: minimum.value}});
  const type = binder.infer(syntax.operand);
  if (!numeric(type)) return undefined;
  if (['++', '--'].includes(syntax.operator)) {
    const operand = binder.bindLValue(syntax.operand);
    binder.bindLoad(operand);
    return binder.node(BoundIncrementOperator, syntax, {
      operator: syntax.operator, operand, isPostfix: !!syntax.postfix, isChecked: binder.overflowChecked(syntax),
    }, type);
  }
  if (syntax.operator === '!' || syntax.operator === '~' && !integral(type) ||
    syntax.operator === '-' && ['ulong', 'nuint'].includes(type)) binder.c.report(syntax, 'CS0023', [syntax.operator, type]);
  const promoted = unaryPromotion(type, syntax.operator);
  const operand = conversion(binder, binder.bindExpression(syntax.operand), promoted);
  const folded = binder.constant(syntax);
  return binder.node(BoundUnaryOperator, syntax, {
    operator: syntax.operator, operand, isChecked: binder.overflowChecked(syntax),
  }, promoted, folded ? {constantValue: {value: folded.value}} : null);
}

function bindCompound(binder, syntax) {
  if (['=', '??='].includes(syntax.operator) || !numeric(binder.infer(syntax.left))) return undefined;
  const left = binder.bindLValue(syntax.left), operator = syntax.operator.slice(0, -1);
  binder.bindLoad(left);
  if (operator === '>>>') binder.c.requireFeature(syntax, 11, 'Unsigned right shift');
  let right = binder.bindExpression(syntax.right);
  const promoted = binaryPromotion(left.legacyType, right.legacyType, operator, null, binder.constant(syntax.right));
  if (!promoted || ['&', '|', '^', '<<', '>>', '>>>'].includes(operator) && !integral(promoted)) {
    binder.c.report(syntax, 'CS0019', [operator, left.legacyType, right.legacyType]);
    return binder.bad(syntax, [left, right]);
  }
  right = conversion(binder, right, ['<<', '>>', '>>>'].includes(operator) ? 'int' : promoted);
  return binder.node(BoundCompoundAssignmentOperator, syntax, {
    operator, left, right, isChecked: binder.overflowChecked(syntax), method: null, negate: false,
  }, left.legacyType);
}

/** Bind the scalar and Array profile before the general closed-framework binder. */
export function bindScalarExpression(binder, syntax) {
  const array = bindArrayBuiltin(binder, syntax, true);
  if (array) return bindProfile(binder, syntax, array, 'array');
  const constant = binder.scalarConstant(syntax);
  if (constant) {
    const value = constantValue(scalarLiteral(constant.value, constant.type), constant.type);
    return binder.node(BoundLiteral, syntax, {value}, constant.type, {constantValue: {value}});
  }
  if(syntax.kind==='New'&&scalarType(syntax.type)==='decimal'&&syntax.args.length===0){
    const value=numericDefault('decimal');
    return binder.node(BoundLiteral,syntax,{value},'decimal',{constantValue:{value}});
  }
  const profile = binder.scalarBinding(syntax, true);
  if (profile) return bindProfile(binder, syntax, profile, 'numeric');
  if (syntax.kind === 'Literal' && numeric(syntax.type)) {
    const value = constantValue(scalarLiteral(syntax.value, syntax.type), syntax.type);
    return binder.node(BoundLiteral, syntax, {value}, syntax.type, {constantValue: {value}});
  }
  if (syntax.kind === 'Binary') return bindBinary(binder, syntax);
  if (syntax.kind === 'Unary') return bindUnary(binder, syntax);
  if (syntax.kind === 'Assignment') return bindCompound(binder, syntax);
  if (syntax.kind === 'Conditional') {
    const type = scalarConditionalType(binder, syntax);
    if (type) return bindConditional(binder, syntax, type);
  }
  if (syntax.kind === 'Cast') {
    const target = binder.c.resolveType(syntax.type, syntax, false, binder.m);
    if (!numeric(target) && frameworkType(target)?.kind !== 'enum') return undefined;
    const operand = binder.bindExpression(syntax.expression), from = operand.legacyType;
    if (!numeric(from) && frameworkType(from)?.kind !== 'enum') binder.c.report(syntax, 'CS0030', [from, target]);
    binder.constant(syntax);
    return binder.node(BoundConversion, syntax, {
      operand, conversion: {kind: 'ExplicitNumeric', from, to: target}, isExplicit: true, isChecked: binder.overflowChecked(syntax),
    }, target);
  }
  if (syntax.kind === 'Call' && syntax.args.length === 0 && syntax.target.kind === 'Member' && syntax.target.name === 'ToString') {
    const type = binder.infer(syntax.target.target);
    if (numeric(type)) return stringCall(binder, binder.bindExpression(syntax.target.target));
  }
  return undefined;
}
