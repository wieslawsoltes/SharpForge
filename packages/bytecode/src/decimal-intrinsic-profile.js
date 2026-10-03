/** Closed Decimal contracts shared by source lowering and direct CIL verification. */
const definitions = [];
const decimal = 'System.Decimal';
const rounding = 'System.MidpointRounding';
function add(owner, name, parameters, returnType, isStatic = true) {
  definitions.push(Object.freeze({owner, name, parameters: Object.freeze(parameters), returnType, isStatic, implementation: 'decimal'}));
}
for (const type of ['int', 'uint', 'long', 'ulong', 'float', 'double', 'int[]']) add(decimal, '.ctor', [type], 'void', false);
add(decimal, '.ctor', ['int', 'int', 'int', 'bool', 'byte'], 'void', false);
for (const name of ['Add', 'Subtract', 'Multiply', 'Divide', 'Remainder', 'op_Addition', 'op_Subtraction',
  'op_Multiply', 'op_Division', 'op_Modulus']) add(decimal, name, [decimal, decimal], decimal);
for (const name of ['op_Equality', 'op_Inequality', 'op_LessThan', 'op_LessThanOrEqual', 'op_GreaterThan',
  'op_GreaterThanOrEqual', 'Equals']) add(decimal, name, [decimal, decimal], 'bool');
add(decimal, 'Compare', [decimal, decimal], 'int');
for (const name of ['Negate', 'Abs', 'Ceiling', 'Floor', 'Truncate', 'op_UnaryNegation', 'op_UnaryPlus',
  'op_Increment', 'op_Decrement']) add(decimal, name, [decimal], decimal);
for (const owner of [decimal, 'System.Math']) {
  for (const parameters of [[decimal], [decimal, 'int'], [decimal, rounding], [decimal, 'int', rounding]]) {
    add(owner, 'Round', parameters, decimal);
  }
}
for (const name of ['Abs', 'Ceiling', 'Floor', 'Truncate']) add('System.Math', name, [decimal], decimal);
for (const name of ['Min', 'Max']) add('System.Math', name, [decimal, decimal], decimal);
add('System.Math', 'Sign', [decimal], 'int');
add(decimal, 'GetBits', [decimal], 'int[]');
add(decimal, 'Parse', ['string'], decimal);
add(decimal, 'TryParse', ['string', decimal + '&'], 'bool');
for (const parameters of [[], ['string']]) add(decimal, 'ToString', parameters, 'string', false);
for (const type of [decimal, 'object']) {
  add(decimal, 'Equals', [type], 'bool', false);
  add(decimal, 'CompareTo', [type], 'int', false);
}
add(decimal, 'GetHashCode', [], 'int', false);
for (const type of ['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong']) {
  add(decimal, 'op_Implicit', [type], decimal);
  add(decimal, 'op_Explicit', [decimal], type);
}
for (const type of ['float', 'double']) {
  add(decimal, 'op_Explicit', [type], decimal);
  add(decimal, 'op_Explicit', [decimal], type);
}
for (const [name, type] of [['SByte', 'sbyte'], ['Byte', 'byte'], ['Int16', 'short'], ['UInt16', 'ushort'],
  ['Int32', 'int'], ['UInt32', 'uint'], ['Int64', 'long'], ['UInt64', 'ulong'], ['Single', 'float'], ['Double', 'double']]) {
  add(decimal, 'To' + name, [decimal], type);
}
export const decimalIntrinsicDefinitions = Object.freeze(definitions);
const constants = new Set(['Zero', 'One', 'MinusOne', 'MaxValue', 'MinValue']);
/** Recognize only built-in readonly Decimal constants, never arbitrary external fields. */
export function isDecimalConstantField(descriptor) {
  return descriptor?.kind === 'field' && descriptor.owner === decimal && constants.has(descriptor.name) &&
    ['decimal', decimal].includes(descriptor.signature?.type);
}
