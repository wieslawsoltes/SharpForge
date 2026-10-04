import {callStorageType} from '@sharpforge/cil';
import {numericTypeName} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {StackCategory} from './numeric-stack-types.js';
import {NumericSlotTag, numericSlots} from './typed-stack.js';

const integerStores = Object.freeze({
  bool: value => value & 255,
  byte: value => value & 255,
  sbyte: value => value << 24 >> 24,
  short: value => value << 16 >> 16,
  ushort: value => value & 65535,
  char: value => value & 65535,
  int: value => value | 0,
  uint: value => value | 0,
});

/** Decode metadata once; pinned locals retain their lifetime/storage adapter. */
export function numericSlotDescription(method, instruction) {
  const match = /^(ld|st)(loc|arg)(?:\.(s|[0-3]))?$/.exec(instruction.name);
  if (!match) return null;
  const [, operation, kind, suffix] = match;
  const argument = kind === 'arg';
  const index = instruction.operand ?? Number(suffix);
  const parameter = index - Number(!method.signature.isStatic);
  const declared = argument ? method.signature.parameters[parameter] : method.locals[index];
  if (typeof declared !== 'string' || /\bpinned$/.test(declared)) return null;
  const type = numericTypeName(callStorageType(declared));
  return {operation, argument, index, type};
}

/** Only normalized scalar slots qualify; pinned locals and byrefs keep adapters. */
export function typedSlotHandler(method, instruction, state, generic) {
  const slot = numericSlotDescription(method, instruction);
  if (!slot || !state) return null;
  const {operation, argument, index, type} = slot;
  const tag = type === 'float' ? NumericSlotTag.r4 : type === 'double' ? NumericSlotTag.r8 : null;
  if (operation === 'ld' && tag) return (vm, frame) => {
    if (vm.options.scalarSlotLoads === false) return generic(vm, frame, instruction);
    const slots = numericSlots(argument ? frame.args : frame.locals);
    if (!slots.tags[index]) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
    numericSlots(frame.stack).pushFloat(slots.numbers[index], tag);
  };
  if (operation !== 'st') return null;
  const input = state.at(-1);
  if (tag && (input === StackCategory.r4 || input === StackCategory.r8)) return (vm, frame) => {
    if (vm.onWrite) return generic(vm, frame, instruction);
    const value = numericSlots(frame.stack).popNumber();
    numericSlots(argument ? frame.args : frame.locals).setFloat(index, value, tag);
    vm.writeRevision++;
  };
  const store = integerStores[type];
  if (store && input === StackCategory.i4) return (vm, frame) => {
    if (vm.onWrite) return generic(vm, frame, instruction);
    (argument ? frame.args : frame.locals)[index] = store(vm.pop());
    vm.writeRevision++;
  };
  return null;
}
