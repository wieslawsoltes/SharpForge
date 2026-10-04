import {CilOpcodes} from '@sharpforge/cil';
import {wasmValueTypes, wasmOperations} from './encoding-profile.js';

const integers = new Set(['i32', 'i64']);
const floats = new Set(['f32', 'f64']);
const categories = new Set([...Object.keys(wasmValueTypes), 'reference', 'unknown']);
const kinds = new Set(['host', 'constant', 'unary', 'binary']);
const optionNames = new Set(['maxMethodInstructions', 'maxBytes']);
const methodFields = new Set(['version', 'token', 'maxStack', 'instructions', 'nativeInstructions']);
const instructionFields = new Set(['pc', 'offset', 'name', 'kind', 'type', 'value', 'inputs', 'pop', 'push',
  'depth', 'next', 'targets', 'requiresOperandGuards']);

function invalid(message) { throw new TypeError('Invalid Wasm IR: ' + message); }
function integer(value, maximum = 0x7fffffff) { return Number.isSafeInteger(value) && value >= 0 && value <= maximum; }

function frozen(value, array = false, fields = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array || !Object.isFrozen(value)) {
    invalid('records and arrays must be immutable');
  }
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid('expected plain IR data');
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) invalid('sparse arrays');
    }
  }
  if (Object.getOwnPropertySymbols(value).length) invalid('symbol properties are not IR data');
  for (const key of Object.getOwnPropertyNames(value)) {
    if (array ? key !== 'length' && (!integer(Number(key), value.length - 1) || String(Number(key)) !== key) : !fields.has(key)) {
      invalid('unknown IR field');
    }
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) invalid('accessors are not IR data');
  }
}

function constant(instruction) {
  const {name, type, value} = instruction;
  const expected = name.startsWith('ldc.i4') ? 'i32' : {'ldc.i8': 'i64', 'ldc.r4': 'f32', 'ldc.r8': 'f64'}[name];
  if (type !== expected || instruction.pop !== 0 || instruction.push !== 1) invalid('constant opcode/type mismatch');
  if (type === 'i32' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647 || Object.is(value, -0))) {
    invalid('constant exceeds i32');
  }
  if (type === 'i64' && (typeof value !== 'bigint' || value < -(1n << 63n) || value >= 1n << 63n)) invalid('constant exceeds i64');
  if (floats.has(type) && typeof value !== 'number') invalid('floating constant must be a number');
  if (type === 'i32' && !['ldc.i4', 'ldc.i4.s'].includes(name)) {
    const fixed = name === 'ldc.i4.m1' ? -1 : Number(name.slice('ldc.i4.'.length));
    if (value !== fixed) invalid('constant macro value mismatch');
  }
  if (name === 'ldc.i4.s' && (value < -128 || value > 127)) invalid('constant exceeds signed byte');
}

function arithmetic(instruction) {
  const {kind, name, type, inputs} = instruction;
  const count = kind === 'unary' ? 1 : 2;
  if (!instruction.requiresOperandGuards || instruction.pop !== count || instruction.push !== 1 || inputs.length !== count ||
      !Object.hasOwn(wasmValueTypes, type) || inputs.some(input => !Object.hasOwn(wasmValueTypes, input))) {
    invalid('arithmetic requires typed operands and guards');
  }
  if (kind === 'unary') {
    if (inputs[0] !== type || name !== 'neg' && !(name === 'not' && integers.has(type))) invalid('unsupported unary operation');
    return;
  }
  if (!Object.hasOwn(wasmOperations[type], name)) invalid('unsupported binary operation');
  if (name.startsWith('sh')) {
    if (!integers.has(type) || inputs[0] !== type || !integers.has(inputs[1])) invalid('unsupported shift operands');
  } else if (floats.has(type)) {
    const expected = inputs.every(input => input === 'f32') ? 'f32' : 'f64';
    if (!inputs.every(input => floats.has(input)) || type !== expected) invalid('unsupported floating promotion');
  } else if (!inputs.every(input => input === type)) invalid('mixed-width integer arithmetic');
}

export function wasmEncodingLimits(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Wasm options must be an object');
  for (const name of Object.keys(options)) if (!optionNames.has(name)) throw new TypeError('Unknown Wasm encoding option: ' + name);
  const instructions = options.maxMethodInstructions ?? 4096;
  const bytes = options.maxBytes ?? 4194304;
  if (!integer(instructions, 65536) || instructions < 1 || !integer(bytes, 16777216) || bytes < 8) {
    throw new RangeError('Invalid Wasm encoding limit');
  }
  return {instructions, bytes};
}

/** Validate immutable version-1 IR before any binary emission or asynchronous compilation. */
export function validateWasmIR(ir, limits) {
  frozen(ir, false, methodFields);
  if (['version', 'token', 'maxStack', 'instructions', 'nativeInstructions'].some(key => !Object.hasOwn(ir, key))) {
    invalid('missing method fields');
  }
  if (ir.version !== 1 || !integer(ir.token, 0xffffffff) || !integer(ir.maxStack, 65535)) invalid('unsupported method header');
  if (!Array.isArray(ir.instructions) || ir.instructions.length < 1 || ir.instructions.length > limits.instructions) {
    throw new RangeError('Wasm instruction limit exceeded');
  }
  frozen(ir.instructions, true);
  let native = 0;
  let metadata = ir.instructions.length;
  for (let pc = 0; pc < ir.instructions.length; pc++) {
    const instruction = ir.instructions[pc];
    frozen(instruction, false, instructionFields);
    if (['pc', 'offset', 'name', 'kind', 'type', 'inputs', 'pop', 'push', 'depth', 'next', 'targets',
      'requiresOperandGuards'].some(key => !Object.hasOwn(instruction, key))) invalid('missing instruction fields');
    if (!Object.hasOwn(CilOpcodes, instruction.name) || !kinds.has(instruction.kind) || instruction.pc !== pc ||
        !integer(instruction.offset) || instruction.next !== pc + 1 || !integer(instruction.pop, 65535) ||
        !integer(instruction.push, 65535) || instruction.depth !== null && !integer(instruction.depth, ir.maxStack)) {
      invalid('malformed instruction');
    }
    if (!Array.isArray(instruction.inputs) || !Array.isArray(instruction.targets)) invalid('missing instruction arrays');
    metadata += instruction.inputs.length + instruction.targets.length;
    if (metadata > limits.bytes) throw new RangeError('Wasm IR metadata limit exceeded');
    frozen(instruction.inputs, true);
    frozen(instruction.targets, true);
    if (instruction.inputs.some(type => !categories.has(type)) || instruction.targets.some(target =>
      !integer(target, ir.instructions.length - 1))) invalid('invalid inputs or control-flow targets');
    const opcode = CilOpcodes[instruction.name];
    const targets = opcode.operand.startsWith('br') ? 1 : opcode.operand === 'switch' ? instruction.targets.length : 0;
    if (instruction.targets.length !== targets) invalid('control-flow target count mismatch');
    if (instruction.depth === null ? instruction.kind !== 'host' || instruction.inputs.length !== 0 :
      instruction.depth < instruction.pop || instruction.inputs.length !== instruction.pop ||
      instruction.depth - instruction.pop + instruction.push > ir.maxStack) invalid('inconsistent input stack');
    if (typeof instruction.requiresOperandGuards !== 'boolean') invalid('missing guard contract');
    if (instruction.kind === 'host') {
      if (instruction.type !== null || instruction.requiresOperandGuards) invalid('invalid host operation');
    } else {
      native++;
      if (instruction.kind === 'constant') {
        if (instruction.requiresOperandGuards) invalid('unexpected constant guard');
        constant(instruction);
      } else arithmetic(instruction);
    }
  }
  if (ir.nativeInstructions !== native) invalid('native instruction count mismatch');
  return ir;
}
