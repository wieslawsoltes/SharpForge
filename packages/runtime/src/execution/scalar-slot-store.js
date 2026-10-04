import {scalarStorageGuard} from './scalar-storage-plan.js';
import {frameById} from './frame-lifetimes.js';

const adapters = new WeakMap();
const arrayPop = Array.prototype.pop;

export function registerScalarStoreAdapters(vm, canonical) { adapters.set(vm, canonical); }

function ordinaryAdapters(vm) {
  const canonical = adapters.get(vm);
  return canonical && vm.address === canonical.address && vm.dereference === canonical.dereference &&
    vm.storage === canonical.storage && vm.pop === canonical.pop;
}

/** Canonical scalar stores need no address allocation or repeated storage conversion. */
export function storeScalarSlot(vm, frame, argument, index) {
  if (vm.options.scalarSlotLoads === false || vm.onWrite || !ordinaryAdapters(vm)) return false;
  const destination = argument ? frame.args : frame.locals, stack = frame.stack;
  if (!Number.isInteger(index) || index < 0 || index >= destination.length ||
      Object.hasOwn(stack, 'pop') || stack.pop !== arrayPop) return false;
  const accepts = scalarStorageGuard(vm.slotType(frame, argument, index));
  if (!accepts) return false;
  // Accessors, inherited holes and frozen slots retain the observable generic read/write path.
  const input = Object.getOwnPropertyDescriptor(stack, stack.length - 1);
  const output = Object.getOwnPropertyDescriptor(destination, index);
  if (!input || !Object.hasOwn(input, 'value') || !output || !Object.hasOwn(output, 'value') || !output.writable ||
      !accepts(input.value, vm.options)) return false;
  if (frameById(vm, frame.id) !== frame) return false;
  destination[index] = vm.pop();
  vm.writeRevision++;
  return true;
}
