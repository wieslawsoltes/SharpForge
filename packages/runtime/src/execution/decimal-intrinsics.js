import {decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {ManagedFault, isReference} from '../heap.js';
import {number, float, storage} from './numeric-ops.js';
import {
  decimal, decimalZero, decimalMaxCoefficient, isDecimal, decimalFromBits, decimalBits,
  decimalParse, decimalFromInteger, decimalFromFloat, decimalToInteger, decimalToFloat,
  decimalCompare, decimalAbs, decimalRound, decimalNegate, decimalBinary, decimalFormat
} from './decimal.js';

export const decimalConstants = Object.freeze({
  Zero: decimalZero, One: decimal(1n), MinusOne: decimal(1n, 0, true),
  MaxValue: decimal(decimalMaxCoefficient), MinValue: decimal(decimalMaxCoefficient, 0, true)
});
const aliases = Object.freeze({
  decimal: 'System.Decimal', 'decimal&': 'System.Decimal&',
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Char': 'char', 'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long',
  'System.UInt64': 'ulong', 'System.Single': 'float', 'System.Double': 'double'
});
const canonical = type => aliases[type] ?? type;
const key = descriptor => {
  const signature = descriptor.signature ?? descriptor;
  return [canonical(descriptor.owner), descriptor.name, signature.isStatic, signature.parameters.map(canonical).join(','),
    canonical(signature.returnType)].join('|');
};
const contracts = new Set(decimalIntrinsicDefinitions.map(key));
const operators = Object.freeze({
  Add: '+', op_Addition: '+', Subtract: '-', op_Subtraction: '-', Multiply: '*', op_Multiply: '*',
  Divide: '/', op_Division: '/', Remainder: '%', op_Modulus: '%', op_Equality: '==', op_Inequality: '!=',
  op_LessThan: '<', op_LessThanOrEqual: '<=', op_GreaterThan: '>', op_GreaterThanOrEqual: '>='
});
const integers = Object.freeze({
  sbyte: [8, false], byte: [8, true], short: [16, false], ushort: [16, true], char: [16, true],
  int: [32, false], uint: [32, true], long: [64, false], ulong: [64, true]
});
const fault = (name, message) => new ManagedFault(name, message);
const context = Object.freeze({fault});
const parseContext = Object.freeze({fault, allowExponent: false, allowThousands: true, allowTrailingSign: true});

function raw(vm, value) {
  if (value?.byref) return raw(vm, vm.dereference(value));
  if (value?.enumType) return raw(vm, value.value);
  if (isReference(value)) {
    const record = vm.heap.get(value);
    if (record.kind === 'box') return raw(vm, record.data[0]);
    if (record.kind === 'string') return record.data;
  }
  return value;
}
function conversion(value, from, to) {
  from = canonical(from);
  to = canonical(to);
  if (to === 'System.Decimal') {
    if (from === 'float' || from === 'double') return decimalFromFloat(number(value), from === 'float' ? 'r4' : 'r8', context);
    const [bits, unsigned] = integers[from];
    return decimalFromInteger(number(value), unsigned, bits, context);
  }
  if (to === 'float' || to === 'double') return float(decimalToFloat(value, to === 'float' ? 'r4' : 'r8', context), to === 'float' ? 'r4' : 'r8');
  const [bits, unsigned] = integers[to];
  return storage(decimalToInteger(value, {bits, unsigned, fault}), to, context);
}
function construct(vm, signature, values) {
  if (signature.parameters.length === 5) {
    const scale = Number(number(values[4]));
    if (!Number.isInteger(scale) || scale < 0 || scale > 28) throw fault('ArgumentOutOfRangeException', 'Decimal scale must be between zero and 28');
    return decimalFromBits([number(values[0]), number(values[1]), number(values[2]),
      (scale << 16) | (number(values[3]) ? 0x80000000 : 0)], context);
  }
  if (signature.parameters[0] === 'int[]') {
    if (values[0] === null) throw fault('ArgumentNullException', 'Decimal bits array is null');
    const record = vm.heap.get(values[0]);
    if (record.kind !== 'array' || record.methodTable.elementType.name !== 'System.Int32') {
      throw fault('ArgumentException', 'Decimal bits require an Int32 array');
    }
    return decimalFromBits(Array.from(record.data), context);
  }
  return conversion(values[0], signature.parameters[0], 'System.Decimal');
}
function parse(vm, name, values) {
  let value = decimalZero, success = true;
  try { value = decimalParse(values[0], parseContext); }
  catch (error) {
    if (name === 'Parse' || !['ArgumentNullException', 'FormatException', 'OverflowException'].includes(error.name)) throw error;
    success = false;
  }
  if (name === 'Parse') return value;
  vm.dereference(values[1], true, value);
  return success;
}
function hash(value) {
  if (!isDecimal(value)) throw fault('InvalidProgramException', 'Decimal value required');
  if (value.coefficient === 0n) return 0;
  let coefficient = value.coefficient, scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return decimalBits(decimal(coefficient, scale, value.negative)).reduce((result, word) => result ^ word, 0);
}
function evaluate(vm, name, signature, receiver, values) {
  const operand = receiver === undefined ? values[0] : raw(vm, receiver);
  if (Object.hasOwn(operators, name)) return decimalBinary(operators[name], values[0], values[1], context);
  if (name === 'op_Implicit' || name === 'op_Explicit' || name.startsWith('To') && name !== 'ToString') {
    return conversion(values[0], signature.parameters[0], signature.returnType);
  }
  if (name === 'Parse' || name === 'TryParse') return parse(vm, name, values);
  if (name === 'ToString') return vm.heap.string(decimalFormat(operand, values[0] ?? 'G', context));
  if (name === 'GetBits') {
    const bits = decimalBits(operand, context), reference = vm.heap.array('int', 4), record = vm.heap.get(reference);
    for (let index = 0; index < bits.length; index++) record.data[index] = bits[index];
    return reference;
  }
  if (name === 'Equals') {
    const other = receiver === undefined ? values[1] : values[0];
    return isDecimal(operand) && isDecimal(other) && decimalCompare(operand, other, context) === 0;
  }
  if (name === 'Compare' || name === 'CompareTo') {
    const other = receiver === undefined ? values[1] : values[0];
    if (other === null) return 1;
    if (!isDecimal(other)) throw fault('ArgumentException', 'Object must be a Decimal');
    return decimalCompare(operand, other, context);
  }
  if (name === 'GetHashCode') return hash(operand);
  if (name === 'Abs') return decimalAbs(operand, context);
  if (name === 'Negate' || name === 'op_UnaryNegation') return decimalNegate(operand, context);
  if (name === 'op_UnaryPlus') return operand;
  if (name === 'op_Increment' || name === 'op_Decrement') return decimalBinary(name === 'op_Increment' ? '+' : '-', operand, decimalConstants.One, context);
  if (name === 'Min' || name === 'Max') {
    const order = decimalCompare(values[0], values[1], context);
    return (name === 'Min' ? order < 0 : order >= 0) ? values[0] : values[1];
  }
  if (name === 'Sign') return decimalCompare(operand, decimalZero, context);
  if (name === 'Ceiling' || name === 'Floor' || name === 'Truncate') return decimalRound(operand, 0, {Ceiling: 4, Floor: 3, Truncate: 2}[name], context);
  if (name === 'Round') {
    const modeOnly = signature.parameters[1] === 'System.MidpointRounding';
    return decimalRound(operand, modeOnly ? 0 : Number(number(values[1] ?? 0)), Number(number(values[modeOnly ? 1 : 2] ?? 0)), context);
  }
  throw fault('MissingMethodException', 'Unimplemented Decimal intrinsic ' + name);
}
/** Adapt verified CIL and source contracts; constructors optionally receive a byref destination. */
export function invokeDecimal(vm, descriptor, args) {
  if (!contracts.has(key(descriptor))) return {handled: false};
  const signature = descriptor.signature ?? descriptor, constructor = descriptor.name === '.ctor';
  const hasReceiver = !signature.isStatic && (!constructor || args.length === signature.parameters.length + 1);
  const receiver = hasReceiver ? args[0] : undefined;
  const values = (hasReceiver ? args.slice(1) : args).map((value, index) =>
    signature.parameters[index]?.endsWith('&') ? value : raw(vm, value));
  let value;
  if (constructor) {
    value = construct(vm, signature, values);
    if (hasReceiver) {
      vm.dereference(receiver, true, value);
      value = null;
    }
  } else value = evaluate(vm, descriptor.name, signature, receiver, values);
  return {handled: true, value: signature.returnType === 'bool' && vm.inspector ? Number(value) : value};
}
