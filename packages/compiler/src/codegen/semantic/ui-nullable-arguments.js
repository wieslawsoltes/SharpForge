import {isNullableType} from '../../conversions/nullable.js';
import {lowered} from '../../lowering/tuples/translate-tuples.js';
import {n} from './node-factory.js';
import {uiNumericLiteral} from './ui-numeric-values.js';

const scalar = new Set(['System_Int32', 'System_UInt32', 'System_Single', 'System_Double', 'System_Boolean']);
const records = new Set(['System.DateTimeOffset', 'System.TimeSpan']);

/** Registry nullable parameters preserve absence without enabling unrelated nullable storage/operator semantics. */
export function uiNullableArguments(translator, node, method) {
  if (!method?.contract || !method.parameters.some(p => isNullableType(p.type))) return node;
  const positions = node.mapping?.parameterOf;
  const args = (node.args ?? []).map((argument, index) => {
    const parameter = method.parameters[positions ? positions[index] : index];
    if (!isNullableType(parameter?.type)) return argument;
    const expression = argument.expression, underlying = parameter.type.nullableUnderlyingType;
    if (!scalar.has(underlying.specialType) && !records.has(translator.g.bridge.registryName(underlying))) {
      return translator.unsupported('this nullable framework parameter type', expression.syntax);
    }
    const value = nullableArgumentValue(translator, expression, underlying);
    return {...argument, expression: lowered(value, parameter.type, expression.syntax)};
  });
  return {...node, args};
}

function nullableArgumentValue(translator, expression, underlying) {
  if (expression.constantValue?.isNull || expression.literal === 'null' || expression.kind === 'Default') return n.nullLiteral('object');
  if (expression.kind === 'Conversion' && expression.conversion?.kind === 'ImplicitNullable' &&
    !isNullableType(expression.operand?.type)) {
    return nullableArgumentValue(translator, expression.operand, underlying);
  }
  const constant = expression.constantValue;
  if (constant && !constant.isNull) {
    const raw = constant.value;
    if (underlying.specialType === 'System_UInt32' || underlying.specialType === 'System_Single') {
      return uiNumericLiteral(translator, raw, underlying.specialType === 'System_UInt32' ? 'uint' : 'float');
    }
    const type = underlying.specialType === 'System_Boolean' ? 'bool' :
      underlying.specialType === 'System_Int32' ? 'int' : 'double';
    return n.literal(raw, type);
  }
  return translator.expression(expression);
}
