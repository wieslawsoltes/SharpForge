import {sourceStore, sourceInputTypes} from './source-storage.js';
import {Op} from '@sharpforge/bytecode';
import {createArray, arrayGet, arraySet, arrayAddress} from './arrays.js';
import {stackSpan, spanGet, spanSet, spanAddress, spanSlice, spanLength, spanCreate} from './spans.js';

/** Source IR memory operations share the same checked runtime helpers as CIL. */
export function executeSourceMemory(vm, operation, a, b) {
  const stack = vm.stack;
  const popIndices = rank => stack.splice(stack.length - rank, rank);
  switch (operation) {
    case Op.SPANDEFAULT: stack.push(spanCreate(vm,vm.image.constants[a],null,0,{readonly:b===1})); return true;
    case Op.NEWRECT: stack.push(createArray(vm, vm.image.constants[a], popIndices(b))); return true;
    case Op.LDRECT: {
      const indices = popIndices(a);
      stack.push(arrayGet(vm, stack.pop(), indices));
      return true;
    }
    case Op.STRECT: {
      const value = stack.pop();
      const indices = popIndices(a);
      const reference = stack.pop();
      stack.push(vm.heap.withRoots([reference, value], () => {
        const type = vm.heap.get(reference).methodTable.elementType;
        return arraySet(vm, reference, indices, sourceStore(vm, value, type, sourceInputTypes(vm).at(-1)));
      }));
      return true;
    }
    case Op.RECTADDR: {
      const indices = popIndices(a);
      stack.push(arrayAddress(vm, stack.pop(), indices));
      return true;
    }
    case Op.STACKALLOC: stack.push(stackSpan(vm, vm.image.constants[a], stack.pop())); return true;
    case Op.SPANGET: {
      const index = stack.pop();
      stack.push(spanGet(vm, stack.pop(), index));
      return true;
    }
    case Op.SPANSET: {
      const value = stack.pop();
      const index = stack.pop();
      const span = stack.pop();
      stack.push(vm.heap.withRoots([span, value], () => spanSet(vm, span, index,
        sourceStore(vm, value, span.elementType, sourceInputTypes(vm).at(-1)))));
      return true;
    }
    case Op.SPANADDR: {
      const index = stack.pop();
      stack.push(spanAddress(vm, stack.pop(), index));
      return true;
    }
    case Op.SPANSLICE: {
      const length = b === 2 ? stack.pop() : null;
      const start = stack.pop();
      stack.push(spanSlice(vm, stack.pop(), start, length));
      return true;
    }
    case Op.SPANREADONLY: {
      const value=stack.pop();
      stack.push(spanCreate(vm,value.elementType,value.pointer,value.length,{readonly:true}));
      return true;
    }
    case Op.SPANLENGTH: stack.push(spanLength(vm, stack.pop())); return true;
    default: return false;
  }
}
