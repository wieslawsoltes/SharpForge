import {smallInt64, smallInt64Binary, smallInt64Compare, smallInt64Unary} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {StackCategory} from './numeric-stack-types.js';
import {numericSlots} from './typed-stack.js';
import {numericSlotDescription} from './typed-slot-handlers.js';

const context = Object.freeze({fault: (name, message) => new ManagedFault(name, message)});
const arithmetic = /^(add|sub|mul|div|rem|and|or|xor|shl|shr)(\.ovf)?(\.un)?$/;
const comparisons = Object.freeze({
  eq: order => order === 0,
  ne: order => order !== 0,
  lt: order => order < 0,
  le: order => order <= 0,
  gt: order => order > 0,
  ge: order => order >= 0,
});

function binaryHandler(name, state) {
  if (state.at(-2) !== StackCategory.i8) return null;
  const shiftCount = name.startsWith('sh') && state.at(-1) === StackCategory.i4;
  if (state.at(-1) !== StackCategory.i8 && !shiftCount) return null;
  if (arithmetic.test(name)) return (vm, frame) => {
    const slots = numericSlots(frame.stack);
    const right = shiftCount ? vm.pop() : slots.popLong();
    const left = slots.popLong();
    slots.pushLong(smallInt64Binary(name, left, right, context));
  };
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, modifier] = match;
  const compare = comparisons[comparison];
  return (vm, frame, instruction) => {
    const slots = numericSlots(frame.stack);
    const right = slots.popLong();
    const left = slots.popLong();
    const result = compare(smallInt64Compare(left, right, !!modifier));
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  };
}

function slotHandler(method, instruction, state, generic) {
  const slot = numericSlotDescription(method, instruction);
  if (!slot || slot.type !== 'long' && slot.type !== 'ulong') return null;
  const {operation, argument, index} = slot;
  if (operation === 'ld') return (vm, frame) => {
    if (vm.options.scalarSlotLoads === false) return generic(vm, frame, instruction);
    const value = numericSlots(argument ? frame.args : frame.locals).readLong(index);
    if (value === undefined) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
    numericSlots(frame.stack).pushLong(value);
  };
  if (state.at(-1) !== StackCategory.i8) return null;
  return (vm, frame) => {
    if (vm.onWrite) return generic(vm, frame, instruction);
    const value = numericSlots(frame.stack).popLong();
    numericSlots(argument ? frame.args : frame.locals).setLong(index, value);
    vm.writeRevision++;
  };
}

/** Number lanes remain tagged Int64; generic consumers always read canonical BigInt. */
export function smallLongHandler(method, instruction, state, generic) {
  if (!state) return null;
  const name = instruction.name;
  if (name === 'ldc.i8') {
    const value = smallInt64(instruction.operand);
    return (vm, frame) => numericSlots(frame.stack).pushLong(value);
  }
  const category = state.at(-1);
  if ((name === 'conv.i8' || name === 'conv.u8') && category === StackCategory.i4) {
    return (vm, frame) => {
      const value = vm.pop();
      numericSlots(frame.stack).pushLong(name === 'conv.u8' ? value >>> 0 : value);
    };
  }
  if (category === StackCategory.i8) {
    if (name === 'pop') return (vm, frame) => numericSlots(frame.stack).discard();
    if (name === 'dup') return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      slots.pushLong(slots.readLong(frame.stack.length - 1));
    };
    if (name === 'neg' || name === 'not') return (vm, frame) => {
      const slots = numericSlots(frame.stack);
      slots.pushLong(smallInt64Unary(name, slots.popLong(), context));
    };
    if (name === 'conv.i4' || name === 'conv.u4') return (vm, frame) => {
      const value = numericSlots(frame.stack).popLong();
      vm.push(typeof value === 'number' ? value | 0 : Number(BigInt.asIntN(32, value)));
    };
  }
  return slotHandler(method, instruction, state, generic) ?? (state.length >= 2 ? binaryHandler(name, state) : null);
}
