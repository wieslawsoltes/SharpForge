/** Operator factory choices and enum promotion in expression trees (SF-A02-T07.5). */
import { TypeKind } from '../symbols/types.js';
import { isNullableType, stripNullable } from '../conversions/nullable.js';
import { isCheckedOperatorName } from '../overload/checked-operators.js';
import { convertTree } from './expression-tree-conversions.js';

const binaryFactories = Object.freeze({
  '+': ['Add', 'AddChecked'], '-': ['Subtract', 'SubtractChecked'], '*': ['Multiply', 'MultiplyChecked'],
  '/': ['Divide'], '%': ['Modulo'], '&': ['And'], '|': ['Or'], '^': ['ExclusiveOr'],
  '<<': ['LeftShift'], '>>': ['RightShift'], '==': ['Equal'], '!=': ['NotEqual'],
  '<': ['LessThan'], '<=': ['LessThanOrEqual'], '>': ['GreaterThan'], '>=': ['GreaterThanOrEqual'],
  '&&': ['AndAlso'], '||': ['OrElse'],
});
const unaryFactories = Object.freeze({ '-': ['Negate', 'NegateChecked'], '+': ['UnaryPlus'], '!': ['Not'], '~': ['Not'] });
const smallIntegral = new Set(['System_Byte', 'System_SByte', 'System_Int16', 'System_UInt16']);
const integral = new Set([...smallIntegral, 'System_Int32', 'System_UInt32', 'System_Int64', 'System_UInt64']);
const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=']);
const isEnum = type => stripNullable(type)?.typeKind === TypeKind.Enum;

function factoryFor(builder, node, factories) {
  const [plain, checkedName] = factories[node.operator] ?? [];
  if (!plain) builder.fail(`operator '${node.operator}'`, node);
  const type = stripNullable(node.type),
    checkedArithmetic = !!node.isChecked && (!!node.method || integral.has(type?.specialType) || isEnum(type));
  return checkedName && (checkedArithmetic || isCheckedOperatorName(node.method?.name ?? '')) ? checkedName : plain;
}

function promotedType(builder, type) {
  const underlying = builder.core.enumUnderlying(stripNullable(type)),
    promoted = smallIntegral.has(underlying.specialType) ? builder.core.int : underlying;
  return isNullableType(type) ? builder.core.nullableOf(promoted) : promoted;
}

function promoteOperand(builder, operand, type, isChecked) {
  if (operand.constantValue && !operand.constantValue.isNull) return builder.constant(operand.constantValue.value, type);
  // A constant's implicit conversion to the enum must not produce an extra enum -> underlying conversion.
  const value = operand.kind === 'Conversion' && operand.conversion?.isImplicit && !operand.conversion.isUserDefined &&
    operand.conversion.kind !== 'NullLiteral' && isEnum(operand.type) ? operand.operand : operand;
  return convertTree(builder, builder.visit(value), type, { isChecked });
}

/** A lifted method's operands have its nullable parameter types, including a non-nullable operand or literal null. */
function liftedOperand(builder, operand, parameterType, isChecked) {
  const type = builder.core.nullableOf(parameterType);
  if (operand.literal === 'null' || operand.constantValue?.isNull) return builder.constant(null, type);
  return convertTree(builder, builder.visit(operand), type, { isChecked });
}

function binary(node) {
  const factory = factoryFor(this, node, binaryFactories),
    method = node.method ?? null,
    enumOperand = !method && [node.left, node.right].find(operand => isEnum(operand.type));
  let operands, resultType = node.type;
  if (enumOperand) {
    const type = promotedType(this, enumOperand.type);
    operands = [node.left, node.right].map(operand => promoteOperand(this, operand, type, !!node.isChecked));
    resultType = comparisons.has(node.operator) ? this.core.bool : type;
  } else if (method && node.isLifted) {
    operands = [node.left, node.right].map((operand, index) => liftedOperand(this, operand, method.parameters[index].type, !!node.isChecked));
  } else operands = [this.visit(node.left), this.visit(node.right)];
  const result = this.node(factory, resultType, {
    operands, method,
    liftToNull: !!node.isLifted && !!method && !method.returnType.equals(node.type),
  });
  return enumOperand ? convertTree(this, result, node.type, { isChecked: !!node.isChecked }) : result;
}

function unary(node) {
  if (node.operator === '+' && !node.method) return this.visit(node.operand);
  const factory = factoryFor(this, node, unaryFactories),
    liftedEnum = !node.method && node.isLifted && isEnum(node.operand.type),
    type = liftedEnum ? promotedType(this, node.operand.type) : node.type,
    operand = liftedEnum
      ? convertTree(this, this.visit(node.operand), type, { isChecked: !!node.isChecked })
      : node.isLifted && node.method
        ? liftedOperand(this, node.operand, node.method.parameters[0].type, !!node.isChecked)
        : this.visit(node.operand),
    result = this.node(factory, type, { operands: [operand], method: node.method ?? null });
  return liftedEnum ? convertTree(this, result, node.type, { isChecked: !!node.isChecked }) : result;
}

/** Bound node kind -> visitor, called with the tree builder as `this`. */
export const expressionTreeOperatorVisitors = Object.freeze({ Binary: binary, Unary: unary });
