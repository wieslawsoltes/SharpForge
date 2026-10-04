import {isNativeNull} from './native-int.js';
import {ManagedFault} from '../heap.js';
import {validateMemoryPointer} from './raw-memory.js';
import {validateSpan} from './span-validation.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

export function memoryLocalType(type) {
  return typeof type === 'string' && type.endsWith(' pinned') ? type.slice(0, -7) : type;
}

/** Ref-struct defaults own no storage and cannot retain an expired stack allocation. */
export function defaultSpan(vm, table) {
  if (table.containsGenericParameters || table.typeArguments.length !== 1) invalid('Span storage requires a closed element type');
  return Object.freeze({span: true, vmOwner: vm.snapshotOwner, elementType: table.typeArguments[0], pointer: null,
    length: 0, readonly: table.name.startsWith('System.ReadOnlySpan')});
}

/** Preserve pointer capabilities through typed local/argument storage without integer coercion. */
export function storeMemoryValue(vm, value, table) {
  if (table.flags.refStruct) {
    const readonly = table.name.startsWith('System.ReadOnlySpan');
    if (!value?.span || !Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner ||
        value.elementType !== table.typeArguments[0] || !Number.isSafeInteger(value.length) || value.length < 0 ||
        value.readonly && !readonly) invalid('Span storage requires its owned exact element type');
    validateSpan(vm, value);
    return readonly && !value.readonly ? Object.freeze({...value, readonly: true}) : value;
  }
  if (value === null || value === 0 || value === 0n) return null;
  if (isNativeNull(value, vm.options)) return null;
  if (!value?.byref || value.vmOwner !== vm.snapshotOwner || !Object.isFrozen(value)) invalid('An owned memory pointer is required');
  if (value.memoryPointer) validateMemoryPointer(vm, value);
  if (table.flags.pointer && !value.memoryPointer) invalid('Native pointer storage requires a live stack or pin capability');
  return value;
}
