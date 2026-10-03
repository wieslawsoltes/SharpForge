import {ManagedFault} from '../heap.js';
import {createArray} from './arrays.js';
import {rawArrayBytes} from './array-storage.js';
import {spanFromArray} from './spans.js';
import {valueLayout} from './value-layout.js';

/** Validate the owned metadata handle and expose its bounded, immutable PE data. */
export function fieldRvaData(vm, handle) {
  if (!Object.isFrozen(handle) || handle?.runtimeHandle !== 'field' || handle.owner !== vm.snapshotOwner) {
    throw new ManagedFault('ArgumentException', 'An owned field handle is required');
  }
  const field = vm.inspector.resolveToken(handle.token);
  const row = vm.inspector.metadata.rows[29]?.find(item => item[1] === (handle.token & 0xffffff));
  if (!field.isStatic || !row || !(field.flags & 0x100)) {
    throw new ManagedFault('ArgumentException', 'Field has no RVA initializer');
  }
  const fieldType = vm.typeSystem.table(field.signature.type);
  const size = vm.inspector.metadata.rows[15]?.find(item => item[2] === (fieldType.definitionToken & 0xffffff))?.[1];
  if (!Number.isSafeInteger(size) || size < 0) throw new ManagedFault('ArgumentException', 'Field initializer size is invalid');
  const offset = vm.inspector.pe.offsetOf(row[0], size);
  return vm.inspector.pe.bytes.subarray(offset, offset + size);
}

/** One rooted backing vector per RVA and element type preserves address identity across calls and snapshots. */
export function fieldRvaSpan(vm, handle, element) {
  const data = fieldRvaData(vm, handle);
  const table = vm.typeSystem.table(element);
  const layout = valueLayout(vm, table);
  if (!table.flags.primitive || layout.containsReferences || !layout.size || data.length % layout.size) {
    throw new ManagedFault('ArgumentException', 'CreateSpan requires a primitive element and a complete RVA payload');
  }
  const key = 'RuntimeHelpers.CreateSpan:' + handle.token + ':' + table.name;
  const array = vm.platform.singleton(key, () => {
    const reference = createArray(vm, table, [data.length / layout.size]);
    rawArrayBytes(vm.heap.get(reference).data).set(data);
    return reference;
  });
  return spanFromArray(vm, table, array, 0, null, {readonly: true});
}
