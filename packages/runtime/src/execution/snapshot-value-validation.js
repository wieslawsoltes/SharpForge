import {isMethodPointer} from './method-pointers.js';
import {valueLayout} from './value-layout.js';
import {castCacheFor} from './casting.js';
import {snapshotAddress, snapshotOwnedTable} from './snapshot-address-validation.js';
import {snapshotInteger as integer, invalidSnapshot as fail} from './snapshot-validation-helpers.js';

const scoped = value => value.byref || value.span || value.typedReference || value.runtimeArgumentHandle || value.argIterator;

function spanValue(context, value) {
  if (!Object.isFrozen(value) || value.vmOwner !== context.vm.snapshotOwner || typeof value.readonly !== 'boolean' ||
      !integer(value.length)) fail('Span state');
  const element = snapshotOwnedTable(context, value.elementType);
  if (element.flags.byRef || element.flags.pointer || element.flags.refStruct || element.name === 'System.Void' ||
      element.containsGenericParameters) fail('Span element type');
  if (value.pointer === null) {
    if (value.length !== 0) fail('Span has no storage');
    return;
  }
  const address = snapshotAddress(context, value.pointer);
  if (address.readonly && !value.readonly) fail('mutable Span over readonly storage');
  if (value.pointer.memoryPointer) {
    const layout = valueLayout(context.metadataVM, element), bytes = value.length * layout.size;
    if (layout.containsReferences || !integer(bytes) || bytes > address.availableBytes) fail('Span byte bounds');
    return;
  }
  const pointer = value.pointer;
  if (pointer.kind === 'string') {
    const record = context.referenceRecord(pointer.owner);
    if (!value.readonly || element !== context.vm.heap.methodTables.get('char') ||
        pointer.index > record.data.length - value.length) fail('readonly string Span bounds or type');
    return;
  }
  if (pointer.kind !== 'array' || pointer.path.length) fail('Span array location');
  const record = context.referenceRecord(pointer.owner), actual = record.methodTable.elementType;
  const compatible = element === actual || value.readonly && !element.flags.valueType && !actual.flags.valueType &&
    castCacheFor(context.vm.heap.methodTables).isAssignableFrom(element, actual);
  if (!record.methodTable.flags.szArray || !compatible || pointer.index > record.data.length - value.length) fail('Span array bounds or type');
}

/** Validate immutable value carriers without copying them or materializing live heap records. */
export function validateSnapshotValue(context, value, {heapStorage = false, historical = false} = {}) {
  const {vm, frames} = context;
  if (heapStorage && scoped(value)) fail('stack-only value escaped into heap storage');
  if (scoped(value) && (!Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner)) fail('stack-only value ownership');
  if (!historical) {
    if (value.byref) snapshotAddress(context, value);
    if (value.span) spanValue(context, value);
    if (value.typedReference) {
      const type = snapshotOwnedTable(context, value.type), address = snapshotAddress(context, value.pointer);
      if (address.onePast || address.type !== type) fail('typed reference location type');
    }
    if (value.runtimeArgumentHandle || value.argIterator) {
      const frame = frames.get(value.frameId);
      if (!frame || !Array.isArray(frame.varargs)) fail('expired runtime argument handle');
      if (value.argIterator && (!integer(value.index) || value.index > frame.varargs.length || typeof value.ended !== 'boolean')) {
        fail('runtime argument iterator state');
      }
    }
  }
  if (value.methodPointer && !isMethodPointer(vm, value)) fail('method pointer ownership');
  if (value.valueType) {
    const type = snapshotOwnedTable(context, value.valueType);
    if (!type.flags.valueType || !Object.isFrozen(value) || !Array.isArray(value.fields) ||
        !Object.isFrozen(value.fields) || value.fields.length !== type.fields.length) fail('value type ownership or shape');
  }
  if (value.nullableType) {
    const type = snapshotOwnedTable(context, value.nullableType);
    if (!type.flags.nullable || !type.nullableType || !Object.isFrozen(value) || typeof value.hasValue !== 'boolean' ||
        !value.hasValue && value.value !== null || value.hasValue && value.value === null ||
        value.hasValue && value.value?.valueType && value.value.valueType !== type.nullableType) fail('nullable ownership or shape');
  }
  if (value.nativeInt && (!Object.isFrozen(value) || value.nativeInt !== vm.heap.methodTables.nativeIntBits ||
      value.nativeInt === 64 && typeof value.value !== 'bigint' || value.nativeInt === 32 && !Number.isInteger(value.value))) {
    fail('native integer ABI');
  }
  if (value.float && (!Object.isFrozen(value) || !['r4', 'r8'].includes(value.float) || typeof value.value !== 'number')) fail('float scalar');
}
