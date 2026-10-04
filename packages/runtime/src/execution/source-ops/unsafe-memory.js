import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {storePinnedLocal} from '../pinned.js';
import {sourcePointerConvert} from '../source-pointer-ops.js';
import {stackAllocate} from '../stack-memory.js';
import {arrayInteger} from '../array-limits.js';
import {valueLayout} from '../value-layout.js';
import {pointerOffset} from '../raw-memory.js';

function allocation(vm, type, length) {
  const element = vm.heap.methodTables.get(type), layout = valueLayout(vm, element);
  if (layout.containsReferences) throw new ManagedFault('NotSupportedException', 'Stackalloc element must be unmanaged');
  const count = arrayInteger(length, 'OverflowException');
  if (count < 0) throw new ManagedFault('OverflowException', 'Stack allocation length cannot be negative');
  return pointerOffset(vm, stackAllocate(vm, count * layout.size), 0, element);
}

/** Source unsafe instructions retain the same lexical pin leases and frame-owned byte regions as CIL. */
export const sourceUnsafeMemoryHandlers = Object.freeze({
  [Op.PIN](vm, frame, type, localIndex) {
    const pointer = storePinnedLocal(vm, frame, localIndex, vm.stack.pop());
    frame.locals[localIndex] = pointer;
    vm.stack.push(sourcePointerConvert(vm, pointer, vm.image.constants[type]));
  },
  [Op.UNPIN](vm, frame, localIndex) {
    frame.locals[localIndex] = storePinnedLocal(vm, frame, localIndex, null);
    vm.stack.push(null);
  },
  [Op.PTRCONVERT](vm, _frame, type) {
    vm.stack.push(sourcePointerConvert(vm, vm.stack.pop(), vm.image.constants[type]));
  },
  [Op.SIZEOF](vm, _frame, type) {
    vm.stack.push(valueLayout(vm, vm.image.constants[type]).size);
  },
  [Op.STACKALLOC_RAW](vm, _frame, type) {
    vm.stack.push(allocation(vm, vm.image.constants[type], vm.stack.pop()));
  }
});
