import {normalizeCallType} from '@sharpforge/cil';
import {numericTypeName} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {StackCategory} from './numeric-stack-types.js';
import {FloatSlotTag, floatSlots} from './typed-stack.js';
import {admitStackPush} from './frame-stack.js';

const tagOf = category => category === StackCategory.r4 ? FloatSlotTag.r4 : category === StackCategory.r8 ? FloatSlotTag.r8 : 0;
const operations = Object.freeze({
  add: (left, right) => left + right, sub: (left, right) => left - right,
  mul: (left, right) => left * right, div: (left, right) => left / right, rem: (left, right) => left % right
});
const comparisons = Object.freeze({
  eq: (left, right) => left === right, ne: (left, right) => left !== right,
  gt: (left, right) => left > right, ge: (left, right) => left >= right,
  lt: (left, right) => left < right, le: (left, right) => left <= right
});

function pushFloat(vm, slots, value, tag) {
  admitStackPush(vm);
  slots.pushFloat(value, tag);
}

function guarded(generic, tags, pushed, operation) {
  return (vm, frame, instruction) => {
    const slots = floatSlots(frame.stack);
    const length = frame.stack.length;
    if (!slots || vm.options.typedNumericStack !== true || length < tags.length ||
        length - tags.length + pushed > slots.capacity) return generic(vm, frame, instruction);
    for (let index = 0; index < tags.length; index++) {
      if (slots.tags[length - tags.length + index] !== tags[index]) return generic(vm, frame, instruction);
    }
    return operation(vm, frame, instruction, slots);
  };
}

function slotHandler(method, instruction, state, generic) {
  const match = /^(ld|st)(loc|arg)(?:\.(s|[0-3]))?$/.exec(instruction.name);
  if (!match) return null;
  const [, operation, kind, suffix] = match;
  const argument = kind === 'arg';
  const index = instruction.operand ?? Number(suffix);
  const parameter = index - Number(!method.signature.isStatic);
  const declared = argument ? method.signature.parameters[parameter] : method.locals[index];
  if (typeof declared !== 'string' || /\bpinned$/.test(declared)) return null;
  const type = numericTypeName(normalizeCallType(declared));
  const tag = type === 'float' ? FloatSlotTag.r4 : type === 'double' ? FloatSlotTag.r8 : 0;
  if (!tag) return null;
  if (operation === 'ld') return guarded(generic, [], 1, (vm, frame, current, stack) => {
    const source = floatSlots(argument ? frame.args : frame.locals);
    if (vm.slotType(frame, argument, index) !== declared || vm.options.scalarSlotLoads === false ||
        source?.tags[index] !== tag) return generic(vm, frame, current);
    pushFloat(vm, stack, source.numbers[index], tag);
  });
  const inputTag = tagOf(state.at(-1));
  if (!inputTag) return null;
  return guarded(generic, [inputTag], 0, (vm, frame, current, stack) => {
    const destination = floatSlots(argument ? frame.args : frame.locals);
    if (vm.slotType(frame, argument, index) !== declared || vm.onWrite || !destination ||
        index >= destination.capacity) return generic(vm, frame, current);
    destination.setFloat(index, stack.popNumber(), tag);
    vm.writeRevision++;
  });
}

/** Select only proven float operations; every invocation still guards the actual slot tags. */
export function typedFloatHandler(method, instruction, state, generic) {
  if (!state) return null;
  const name = instruction.name;
  const local = slotHandler(method, instruction, state, generic);
  if (local) return local;
  if (name === 'ldc.r4' || name === 'ldc.r8') {
    const tag = name === 'ldc.r4' ? FloatSlotTag.r4 : FloatSlotTag.r8;
    return guarded(generic, [], 1, (vm, frame, current, slots) => pushFloat(vm, slots, current.operand, tag));
  }
  const right = tagOf(state.at(-1));
  if (!right) return null;
  if (name === 'pop') return guarded(generic, [right], 0, (vm, frame, current, slots) => { slots.popNumber(); });
  if (name === 'dup') return guarded(generic, [right], 2, (vm, frame, current, slots) => {
    pushFloat(vm, slots, slots.numbers[frame.stack.length - 1], right);
  });
  if (['neg', 'conv.r4', 'conv.r8', 'ckfinite'].includes(name)) {
    const tag = name === 'conv.r4' ? FloatSlotTag.r4 : name === 'conv.r8' ? FloatSlotTag.r8 : right;
    return guarded(generic, [right], 1, (vm, frame, current, slots) => {
      const value = slots.popNumber();
      if (name === 'ckfinite' && !Number.isFinite(value)) {
        throw new ManagedFault('ArithmeticException', 'Non-finite floating-point value');
      }
      pushFloat(vm, slots, name === 'neg' ? -value : value, tag);
    });
  }
  const left = tagOf(state.at(-2));
  if (!left) return null;
  if (operations[name]) {
    const operation = operations[name];
    const tag = left === right ? left : FloatSlotTag.r8;
    return guarded(generic, [left, right], 1, (vm, frame, current, slots) => {
      const second = slots.popNumber();
      const first = slots.popNumber();
      pushFloat(vm, slots, operation(first, second), tag);
    });
  }
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, unsigned] = match;
  const compare = comparisons[comparison];
  return guarded(generic, [left, right], form === 'c' ? 1 : 0, (vm, frame, current, slots) => {
    const second = slots.popNumber();
    const first = slots.popNumber();
    const unordered = Number.isNaN(first) || Number.isNaN(second);
    const result = unordered ? comparison === 'ne' || !!unsigned : compare(first, second);
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(current.operand);
  });
}
