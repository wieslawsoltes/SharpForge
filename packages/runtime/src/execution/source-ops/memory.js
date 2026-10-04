import {Op} from '@sharpforge/bytecode';
import {createArray, arrayGet, arraySet, arrayAddress} from '../arrays.js';
import {stackSpan, spanGet, spanSet, spanAddress, spanSlice, spanLength, spanCreate} from '../spans.js';
import {sourceStore, sourceInputTypes} from '../source-storage.js';
import {storageDefault} from '../storage.js';

const indices = (vm, rank) => vm.stack.splice(vm.stack.length - rank, rank);

/** The source interpreter shares the checked CIL array/ref-struct storage implementations. */
export const sourceMemoryHandlers = Object.freeze({
  [Op.NEWRECT](vm, _frame, type, rank) {
    vm.stack.push(createArray(vm, vm.image.constants[type], indices(vm, rank)));
  },
  [Op.LDRECT](vm, _frame, rank) {
    const location = indices(vm, rank);
    vm.stack.push(arrayGet(vm, vm.stack.pop(), location));
  },
  [Op.STRECT](vm, _frame, rank) {
    const value = vm.stack.pop(), location = indices(vm, rank), reference = vm.stack.pop();
    vm.stack.push(vm.heap.withRoots([reference, value], () => {
      const element = vm.heap.get(reference).methodTable.elementType;
      return arraySet(vm, reference, location, sourceStore(vm, value, element, sourceInputTypes(vm).at(-1)));
    }));
  },
  [Op.RECTADDR](vm, _frame, rank) {
    const location = indices(vm, rank);
    vm.stack.push(arrayAddress(vm, vm.stack.pop(), location));
  },
  [Op.STACKALLOC](vm, _frame, type) {
    vm.stack.push(stackSpan(vm, vm.image.constants[type], vm.stack.pop()));
  },
  [Op.SPANGET](vm) {
    const index = vm.stack.pop();
    vm.stack.push(spanGet(vm, vm.stack.pop(), index));
  },
  [Op.SPANSET](vm) {
    const value = vm.stack.pop(), index = vm.stack.pop(), span = vm.stack.pop();
    vm.stack.push(vm.heap.withRoots([span, value], () =>
      spanSet(vm, span, index, sourceStore(vm, value, span.elementType, sourceInputTypes(vm).at(-1)))));
  },
  [Op.SPANADDR](vm) {
    const index = vm.stack.pop();
    vm.stack.push(spanAddress(vm, vm.stack.pop(), index));
  },
  [Op.SPANSLICE](vm, _frame, _unused, arity) {
    const length = arity === 2 ? vm.stack.pop() : null, start = vm.stack.pop();
    vm.stack.push(spanSlice(vm, vm.stack.pop(), start, length));
  },
  [Op.SPANREADONLY](vm) {
    const value = vm.stack.pop();
    vm.stack.push(spanCreate(vm, value.elementType, value.pointer, value.length, {readonly: true}));
  },
  [Op.SPANLENGTH](vm) { vm.stack.push(spanLength(vm, vm.stack.pop())); },
  [Op.SPANDEFAULT](vm, _frame, type) { vm.stack.push(storageDefault(vm, vm.image.constants[type])); }
});
