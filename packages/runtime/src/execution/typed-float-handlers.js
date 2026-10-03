import {StackCategory} from './numeric-stack-types.js';
import {NumericSlotTag, numericSlots} from './typed-stack.js';
import {ManagedFault} from '../heap.js';

const floating = new Set([StackCategory.r4, StackCategory.r8]);
const operations = Object.freeze({
  add: (left, right) => left + right,
  sub: (left, right) => left - right,
  mul: (left, right) => left * right,
  div: (left, right) => left / right,
  rem: (left, right) => left % right,
});
const comparisons = Object.freeze({
  eq: (left, right) => left === right,
  ne: (left, right) => left !== right,
  gt: (left, right) => left > right,
  ge: (left, right) => left >= right,
  lt: (left, right) => left < right,
  le: (left, right) => left <= right,
});
const tagOf = category => category === StackCategory.r4 ? NumericSlotTag.r4 : NumericSlotTag.r8;

function binary(name, state) {
  const left = state.at(-2);
  const right = state.at(-1);
  if (!floating.has(left) || !floating.has(right)) return null;
  const operation = operations[name];
  if (operation) {
    const tag = tagOf(left === right ? left : StackCategory.r8);
    return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      const second = slots.popNumber();
      const first = slots.popNumber();
      slots.pushFloat(operation(first, second), tag);
    };
  }
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, modifier] = match;
  const compare = comparisons[comparison];
  return (vm, frame, instruction) => {
    const slots = numericSlots(frame.stack);
    const second = slots.popNumber();
    const first = slots.popNumber();
    const unordered = Number.isNaN(first) || Number.isNaN(second);
    const result = unordered ? comparison === 'ne' || !!modifier : compare(first, second);
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  };
}

/** Select raw F operations once; the call site guarantees a typed frame adapter. */
export function typedFloatHandler(name, state) {
  if (!state) return null;
  if (name === 'ldc.r4' || name === 'ldc.r8') {
    const tag = name === 'ldc.r4' ? NumericSlotTag.r4 : NumericSlotTag.r8;
    return (vm, frame, instruction) => numericSlots(frame.stack).pushFloat(instruction.operand, tag);
  }
  const category = state.at(-1);
  if ((name === 'conv.r4' || name === 'conv.r8' || name === 'conv.r.un') &&
      (category === StackCategory.i4 || category === StackCategory.i8)) {
    const tag = name === 'conv.r4' ? NumericSlotTag.r4 : NumericSlotTag.r8;
    const unsigned = name === 'conv.r.un';
    return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      const value = category === StackCategory.i8 ? slots.popLong() : vm.pop();
      const raw = !unsigned ? value : category === StackCategory.i4 ? value >>> 0 :
        value < 0 ? BigInt.asUintN(64, BigInt(value)) : value;
      slots.pushFloat(Number(raw), tag);
    };
  }
  if (floating.has(category)) {
    if (name === 'pop') return (vm, frame) => numericSlots(frame.stack).discard();
    if (name === 'dup') return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      slots.pushFloat(slots.numbers[frame.stack.length - 1], tagOf(category));
    };
    if (name === 'ckfinite') return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      const value = slots.popNumber();
      if (!Number.isFinite(value)) throw new ManagedFault('ArithmeticException', 'Non-finite floating-point value');
      slots.pushFloat(value, tagOf(category));
    };
    if (name === 'neg' || name === 'conv.r4' || name === 'conv.r8') {
      const tag = name === 'conv.r4' ? NumericSlotTag.r4 : name === 'conv.r8' ? NumericSlotTag.r8 : tagOf(category);
      return (vm, frame) => {
        const slots = numericSlots(frame.stack);
        const value = slots.popNumber();
        slots.pushFloat(name === 'neg' ? -value : value, tag);
      };
    }
  }
  return state.length >= 2 ? binary(name, state) : null;
}
