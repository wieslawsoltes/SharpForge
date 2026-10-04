import { typeName } from './expressions.js';

const operators = Object.freeze({
  add: '+', sub: '-', mul: '*', div: '/', rem: '%', and: '&', or: '|', xor: '^', shl: '<<', shr: '>>', ceq: '==', cgt: '>', clt: '<',
});
const conversions = Object.freeze({
  i1: 'sbyte', u1: 'byte', i2: 'short', u2: 'ushort', i4: 'int', u4: 'uint', i8: 'long', u8: 'ulong',
  r4: 'float', r8: 'double', i: 'nint', u: 'nuint',
});

function constant(context, instruction) {
  const { name, operand } = instruction;
  if (name === 'ldc.i8') return context.push(`${operand}L`, 'long');
  if (name === 'ldc.r4' || name === 'ldc.r8') {
    const type = name === 'ldc.r4' ? 'float' : 'double';
    const suffix = type === 'float' ? 'f' : 'd';
    const text = Number.isNaN(operand) ? `${type}.NaN` : operand === Infinity ? `${type}.PositiveInfinity`
      : operand === -Infinity ? `${type}.NegativeInfinity` : (Object.is(operand, -0) ? '-0' : String(operand)) + suffix;
    return context.push(text, type);
  }
  context.push(String(name === 'ldc.i4.m1' ? -1 : operand ?? Number(name.slice(7))));
}

function local(context, instruction) {
  const { name, operand } = instruction;
  const index = operand ?? Number(name.split('.').at(-1));
  const argument = name.startsWith('ldarg') || name.startsWith('starg');
  const value = argument ? context.argument(index) : { text: `v${index}`, type: context.method.locals[index] };
  if (name.startsWith('st')) context.emit(`${value.text} = ${context.coerce(context.pop(), value.type)};`);
  else context.capture(value.text, value.type);
}

function duplicate(context) {
  const value = context.pop();
  const name = `stack${context.temporary++}`;
  context.emit(`${typeName(value.type)} ${name} = ${value.text};`);
  context.push(name, value.type);
  context.push(name, value.type);
}

function unary(context, instruction) {
  const value = context.pop();
  context.capture(`(${instruction.name === 'neg' ? '-' : '~'}${value.text})`, value.type);
}

function convert(context, instruction) {
  const value = context.pop();
  const target = instruction.name.replace('conv.', '').replace('ovf.', '');
  const type = conversions[target];
  if (!type) throw new Error(`Conversion ${instruction.name} needs signedness analysis`);
  const expression = `(${type})(${value.text})`;
  context.capture(instruction.name.includes('ovf') ? `checked(${expression})` : `unchecked(${expression})`, type);
}

function binary(context, instruction) {
  const right = context.pop();
  const left = context.pop();
  const name = instruction.name;
  const operator = operators[name.split('.')[0]];
  const comparison = ['ceq', 'cgt', 'clt'].includes(name);
  const expression = `(${left.text} ${operator} ${right.text})`;
  const checked = name.endsWith('.ovf');
  const unchecked = !comparison && ['add', 'sub', 'mul'].includes(name);
  context.capture(checked ? `checked(${expression})` : unchecked ? `unchecked(${expression})` : expression,
    comparison ? 'bool' : left.type);
}

/** Match the existing lowering families once when constructing the opcode handler table. */
export function valueInstructionHandler(opcode) {
  const name = opcode.name;
  if (name.startsWith('ldc.')) return constant;
  if (/^(ldarg|starg|ldloc|stloc)(\.|$)/.test(name)) return local;
  if (name.startsWith('conv.')) return convert;
  if (Object.hasOwn(operators, name) || /^(add|sub|mul)\.ovf$/.test(name)) return binary;
  return valueHandlers[name];
}

const valueHandlers = Object.freeze({
  nop() {},
  break() {},
  ldnull: context => context.push('null', 'object'),
  ldstr: (context, instruction) => context.push(JSON.stringify(context.inspector.metadata.userString(instruction.operand)), 'string'),
  dup: duplicate,
  pop: context => context.emit(`_ = ${context.pop().text};`),
  neg: unary,
  not: unary,
});
