import {stackEffect} from '@sharpforge/cil';
import {StackCategory, numericStackTypes} from '../numeric-stack-types.js';

const types = Object.freeze({
  [StackCategory.i4]: 'i32', [StackCategory.i8]: 'i64',
  [StackCategory.r4]: 'f32', [StackCategory.r8]: 'f64',
  [StackCategory.reference]: 'reference',
});
const integers = new Set(['i32', 'i64']);
const floats = new Set(['f32', 'f64']);
const numeric = new Set([...integers, ...floats]);
const arithmetic = new Set(['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr', 'shr.un']);

function nativeOperation(instruction, inputs) {
  const name = instruction.name;
  if (name.startsWith('ldc.')) {
    const type = name.startsWith('ldc.i4') ? 'i32' :
      ({'ldc.i8': 'i64', 'ldc.r4': 'f32', 'ldc.r8': 'f64'})[name];
    const value = instruction.operand ?? (name === 'ldc.i4.m1' ? -1 : Number(name.split('.').at(-1)));
    return type ? {kind: 'constant', type, value} : null;
  }
  if (['neg', 'not'].includes(name) && numeric.has(inputs[0])) {
    if (name === 'not' && !integers.has(inputs[0])) return null;
    return {kind: 'unary', type: inputs[0]};
  }
  if (!arithmetic.has(name) || inputs.length !== 2 || !inputs.every(type => numeric.has(type))) return null;
  const [left, right] = inputs;
  if (name.startsWith('sh') && integers.has(left) && integers.has(right)) return {kind: 'binary', type: left};
  const type = left === right ? left : floats.has(left) && floats.has(right) ? 'f64' : null;
  if (!type || !integers.has(type) && !['add', 'sub', 'mul'].includes(name)) return null;
  return {kind: 'binary', type};
}

/** Immutable, SSA-less typed stack IR; PCs and branch targets are instruction indices. */
export function lowerWasmIR(vm, method, offsets) {
  const states = numericStackTypes(vm.inspector, method, offsets);
  const instructions = method.instructions.map((instruction, pc) => {
    const [pop, push] = stackEffect(vm.inspector, method, instruction);
    const before = states[pc];
    const inputs = Object.freeze(before?.slice(before.length - pop).map(type => types[type] ?? 'unknown') ?? []);
    const operation = before ? nativeOperation(instruction, inputs) : null;
    const targets = instruction.name === 'switch' ? instruction.operand.map(offset => offsets.get(offset)) :
      instruction.operandKind.startsWith('br') ? [offsets.get(instruction.operand)] : [];
    return Object.freeze({pc, offset: instruction.offset, name: instruction.name,
      kind: operation?.kind ?? 'host', type: operation?.type ?? null, value: operation?.value,
      inputs, pop, push, depth: before?.length ?? null, next: pc + 1, targets: Object.freeze(targets)});
  });
  return Object.freeze({version: 1, token: method.token, maxStack: method.maxStack,
    instructions: Object.freeze(instructions), nativeInstructions: instructions.filter(item => item.kind !== 'host').length});
}
