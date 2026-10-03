import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';
import {StaticDataMetadata} from './static-data-metadata.js';

function targetBinding(heap, reference) {
  if (!isReference(reference)) throw new ManagedFault('ArgumentException', 'A managed primitive array is required');
  const record = heap.get(reference);
  const binding = heap.spaces.byHandle.get(reference.h);
  if (record.kind !== 'array' || !binding?.codec || binding.arena.hostBacked || record.descriptor.scan !== 'none') {
    throw new ManagedFault('ArgumentException', 'InitializeArray requires primitive or enum array elements');
  }
  if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen array storage is immutable');
  return binding;
}

/** Copy validated FieldRVA bytes into a mutable primitive array; the source stays frozen. */
export function initializeArray(vm, destination, fieldHandle) {
  if (destination === null || destination === undefined) throw new ManagedFault('ArgumentNullException', 'array');
  const heap = vm.heap;
  const target = targetBinding(heap, destination);
  if (!vm.inspector?.metadata || !vm.snapshotOwner) {
    throw new ManagedFault('NotSupportedException', 'InitializeArray requires managed PE field metadata');
  }
  const frozen = heap.spaces.frozen;
  let metadata = frozen.sourceMetadata.get(vm.inspector);
  if (!metadata || metadata.pointerSize !== heap.descriptors.pointerSize) {
    metadata = new StaticDataMetadata(vm.inspector, heap.descriptors.pointerSize);
    frozen.sourceMetadata.set(vm.inspector, metadata);
  }
  const field = metadata.field(vm, fieldHandle);
  const byteLength = target.block.byteLength;
  if (byteLength > field.byteLength) throw new ManagedFault('ArgumentException', 'The destination is larger than the RVA field data');
  if (byteLength === 0) return;
  heap.withRoots([destination], () => {
    const bytes = vm.inspector.pe.bytes.subarray(field.offset, field.offset + field.byteLength);
    const reference = frozen.source(vm.snapshotOwner, field.key, bytes);
    const source = heap.spaces.byHandle.get(reference.h);
    const current = targetBinding(heap, destination);
    current.arena.bytes.set(source.arena.bytes.subarray(source.block.offset, source.block.offset + byteLength), current.block.offset);
    heap.barriers.publishRange(destination, 0, current.length, 'array-initialize', {referenceStores: 0});
  });
}
