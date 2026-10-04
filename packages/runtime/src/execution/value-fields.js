import {ManagedFault, isReference} from '../heap.js';
import {isValueRecord} from './value-types.js';
import {loadFieldValue} from './field-storage.js';
import {finishMemoryAccess} from './statics.js';

/** Existing field resolution validates closed owner identity for both heap and inline receivers. */
export function executeFieldAccess(vm, frame, instruction, name) {
  try {
    const replacement = name === 'stfld' ? vm.pop() : undefined;
    const receiver = vm.pop();
    const value = receiver?.byref ? vm.dereference(receiver) : receiver;
    const inline = isValueRecord(value);
    const resolved = inline ? vm.typeSystem.fieldCache.resolve(instruction.operand, value.valueType) : vm.field(instruction.operand, value);
    if (name === 'ldfld') {
      const data = inline ? value.fields : resolved.record.data;
      vm.push(loadFieldValue(vm, resolved.field, data[resolved.index]));
      return;
    }
    if (inline && resolved.field.flags & 0x20) {
      throw new ManagedFault('NotSupportedException', 'Writable addresses to readonly struct fields are not implemented');
    }
    if (inline && !receiver?.byref) throw new ManagedFault('InvalidProgramException', 'Struct mutation requires an addressable receiver');
    const owner = isReference(value) ? value : receiver;
    const address = vm.address('field', resolved.index, owner);
    if (name === 'stfld') vm.dereference(address, true, replacement);
    else vm.push(address);
  } finally { finishMemoryAccess(frame); }
}
