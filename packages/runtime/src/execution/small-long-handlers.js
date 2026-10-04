import {normalizeCallType} from '@sharpforge/cil';
import {numericTypeName} from '@sharpforge/bytecode';
import {admitStackPush} from './frame-stack.js';
import {StackCategory} from './numeric-stack-types.js';
import {floatSlots, SmallLongSlotTag} from './typed-stack.js';
import {smallLongNumber, smallLongOperation, smallLongConversion, compareSmallLong} from './int64-fast.js';

const comparisons = Object.freeze({
  eq: order => order === 0, ne: order => order !== 0,
  gt: order => order > 0, ge: order => order >= 0,
  lt: order => order < 0, le: order => order <= 0
});

function pushLong(vm, slots, value) {
  admitStackPush(vm);
  slots.pushLong(value);
}

function guarded(generic, consumed, pushed, execute) {
  return (vm, frame, instruction) => {
    const slots = floatSlots(frame.stack);
    const length = frame.stack.length;
    if (vm.options.smallLongs !== true || !slots?.smallLongs || length < consumed ||
        length - consumed + pushed > slots.capacity) return generic(vm, frame, instruction);
    for (let index = length - consumed; index < length; index++) {
      if (slots.tags[index] !== SmallLongSlotTag) return generic(vm, frame, instruction);
    }
    return execute(vm, frame, instruction, slots);
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
  if (type !== 'long' && type !== 'ulong') return null;
  if (operation === 'ld') return guarded(generic, 0, 1, (vm, frame, current, stack) => {
    const source = floatSlots(argument ? frame.args : frame.locals);
    if (vm.slotType(frame, argument, index) !== declared || vm.options.scalarSlotLoads === false ||
        source?.tags[index] !== SmallLongSlotTag) return generic(vm, frame, current);
    pushLong(vm, stack, source.numbers[index]);
  });
  if (state.at(-1) !== StackCategory.i8) return null;
  return guarded(generic, 1, 0, (vm, frame, current, stack) => {
    const destination = floatSlots(argument ? frame.args : frame.locals);
    if (vm.slotType(frame, argument, index) !== declared || vm.onWrite || !destination?.smallLongs ||
        index >= destination.capacity) return generic(vm, frame, current);
    destination.setLong(index, stack.popNumber());
    vm.writeRevision++;
  });
}

function binaryHandler(name, generic) {
  const operation = smallLongOperation(name);
  if (operation) return guarded(generic, 2, 1, (vm, frame, instruction, slots) => {
    const length = frame.stack.length;
    const result = operation(slots.numbers[length - 2], slots.numbers[length - 1]);
    // The generic path must see the original exact operands, never a rounded Number result.
    if (result === undefined) return generic(vm, frame, instruction);
    slots.popNumber();
    slots.popNumber();
    pushLong(vm, slots, result);
  });
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, unsigned] = match;
  const accepts = comparisons[comparison];
  return guarded(generic, 2, form === 'c' ? 1 : 0, (vm, frame, instruction, slots) => {
    const right = slots.popNumber();
    const left = slots.popNumber();
    const result = accepts(compareSmallLong(left, right, !!unsigned));
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  });
}

function conversionHandler(name, generic) {
  const convert = smallLongConversion(name);
  if (!convert) return null;
  return guarded(generic, 0, 0, (vm, frame, instruction, slots) => {
    const index = frame.stack.length - 1;
    const value = slots.values[index];
    // An Int32 fact cannot authorize edited float/native/Int64 tags or noncanonical Numbers.
    if (slots.tags[index] !== 0 || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      return generic(vm, frame, instruction);
    }
    const result = convert(value);
    if (result === undefined) return generic(vm, frame, instruction);
    vm.pop();
    pushLong(vm, slots, result);
  });
}

/** Tagged safe Numbers are private Int64 slots; fallback preserves each original CLI operand category. */
export function smallLongHandler(method, instruction, state, generic) {
  if (!state) return null;
  const name = instruction.name;
  let handler = slotHandler(method, instruction, state, generic);
  if (!handler && state.at(-1) === StackCategory.i4) handler = conversionHandler(name, generic);
  if (!handler && name === 'ldc.i8') handler = guarded(generic, 0, 1, (vm, frame, current, slots) => {
    const value = smallLongNumber(current.operand);
    if (value === undefined) return generic(vm, frame, current);
    pushLong(vm, slots, value);
  });
  if (!handler && state.at(-1) === StackCategory.i8) {
    if (name === 'pop') handler = guarded(generic, 1, 0, (vm, frame, current, slots) => { slots.popNumber(); });
    else if (name === 'dup') handler = guarded(generic, 1, 2,
      (vm, frame, current, slots) => pushLong(vm, slots, slots.numbers[frame.stack.length - 1]));
    else if (name === 'neg') handler = guarded(generic, 1, 1,
      (vm, frame, current, slots) => pushLong(vm, slots, -slots.popNumber()));
    else if (state.at(-2) === StackCategory.i8) handler = binaryHandler(name, generic);
  }
  return handler ? {id: name.replaceAll('.', '_') + '_small_i8', handler} : null;
}
