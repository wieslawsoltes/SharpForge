import {validatePointer, pointerType} from './managed-pointers.js';
import {valueLayout} from './value-layout.js';
import {castCacheFor} from './casting.js';
import {primitiveArrayConstructor} from './array-storage.js';

const fail = message => { throw new TypeError('Invalid memory snapshot: ' + message); };
const sameReference = (left, right) => left?.h === right?.h && left?.g === right?.g;

function ownedTable(context, table) {
  if (!table || !Object.isFrozen(table) || table.registry !== context.heap.methodTables) fail('value type ownership');
  return table;
}

function managedAddress(context, pointer) {
  try {
    validatePointer(context, pointer, {allowUninitialized: true});
    return pointerType(context, pointer);
  } catch (error) {
    fail('managed address: ' + error.message);
  }
}

/** Validate owned locations against captured regions, handles, slots and types. */
export function snapshotAddress(context, pointer) {
  if (!pointer?.byref || pointer.vmOwner !== context.snapshotOwner || !Object.isFrozen(pointer) ||
      !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || typeof pointer.readonly !== 'boolean') fail('address ownership');
  if (!pointer.memoryPointer) return {type: managedAddress(context, pointer)};
  const type = ownedTable(context, pointer.baseType);
  if (!Number.isSafeInteger(pointer.index) || pointer.index < 0 || pointer.path.length) fail('raw address offset');
  let byteLength;
  if (pointer.kind === 'reinterpret') {
    if (!pointer.source?.byref || pointer.source.memoryPointer) fail('reinterpretation source');
    const actual = managedAddress(context, pointer.source);
    const source = ownedTable(context, pointer.sourceType);
    if (actual !== source || pointer.source.readonly && !pointer.readonly) fail('reinterpretation source type');
    const layout = valueLayout(context, source);
    if (layout.containsReferences || valueLayout(context, type).containsReferences) fail('reinterpretation references');
    byteLength = layout.size;
  } else {
    const frame = context.frameIndex.get(pointer.frameId);
    if (!frame) fail('expired frame');
    if (pointer.kind === 'stack') {
      const region = frame.stackRegions?.get(pointer.regionId);
      if (!region || pointer.owner !== null) fail('expired stack region or owner');
      byteLength = region.bytes.byteLength;
    } else if (pointer.kind === 'pinned') {
      const lease = frame.pinLeases?.get(pointer.localIndex);
      if (!lease?.active || lease.id !== pointer.leaseId || !sameReference(lease.owner, pointer.owner)) fail('expired pin');
      const record = context.heap.get(pointer.owner);
      if (!primitiveArrayConstructor(record.methodTable.elementType)) fail('pinned reference storage');
      byteLength = record.data.byteLength;
    } else fail('pointer kind');
  }
  if (!Number.isSafeInteger(byteLength) || pointer.index > byteLength) fail('raw address bounds');
  return {type, availableBytes: byteLength - pointer.index};
}

function spanValue(context, value) {
  if (!Object.isFrozen(value) || value.vmOwner !== context.snapshotOwner || typeof value.readonly !== 'boolean' ||
      !Number.isSafeInteger(value.length) || value.length < 0) fail('Span state');
  const element = ownedTable(context, value.elementType);
  if (element.flags.byRef || element.flags.pointer || element.flags.refStruct || element.name === 'System.Void' ||
      element.containsGenericParameters) fail('Span element type');
  if (value.pointer === null) {
    if (value.length !== 0) fail('Span has no storage');
    return;
  }
  const address = snapshotAddress(context, value.pointer);
  if (value.pointer.readonly && !value.readonly) fail('mutable Span over readonly storage');
  if (value.pointer.memoryPointer) {
    const layout = valueLayout(context, element);
    const bytes = value.length * layout.size;
    if (layout.containsReferences || !Number.isSafeInteger(bytes) || bytes > address.availableBytes) fail('Span byte bounds');
    return;
  }
  const pointer = value.pointer;
  if (pointer.kind !== 'array' || pointer.path.length) fail('Span location');
  const record = context.heap.get(pointer.owner);
  const actual = record.methodTable.elementType;
  const compatible = element === actual || value.readonly && !element.flags.valueType && !actual.flags.valueType &&
    castCacheFor(context.heap.methodTables).isAssignableFrom(element, actual);
  if (!record.methodTable.flags.szArray || !compatible || pointer.index > record.data.length - value.length) fail('Span array bounds or type');
}

function runtimeArgumentValue(context, value) {
  if (!Object.isFrozen(value) || value.vmOwner !== context.snapshotOwner) fail('runtime argument ownership');
  if (value.typedReference) {
    if (snapshotAddress(context, value.pointer).type !== ownedTable(context, value.type)) fail('typed reference location type');
    return;
  }
  const frame = context.frameIndex.get(value.frameId);
  const method = context.inspector ? frame?.method?.signature : context.image.methods[frame?.methodId];
  if (method?.callingConvention !== 5 || !Array.isArray(frame?.varargs)) fail('runtime argument frame');
  if (value.argIterator && (!Number.isInteger(value.index) || value.index < 0 || value.index > frame.varargs.length ||
      typeof value.ended !== 'boolean')) fail('runtime argument cursor');
}

/** Value wrappers are immutable; managed references inside them remain shared identities. */
export function snapshotMemoryValue(context, value, {heapStorage = false} = {}) {
  if (heapStorage && (value.byref || value.span || value.typedReference || value.runtimeArgumentHandle || value.argIterator)) {
    fail('stack-only value escaped to heap storage');
  }
  if (value.byref) snapshotAddress(context, value);
  if (value.span) spanValue(context, value);
  if (value.typedReference || value.runtimeArgumentHandle || value.argIterator) runtimeArgumentValue(context, value);
  if (value.valueType) {
    const type = ownedTable(context, value.valueType);
    if (!type.flags.valueType || !Object.isFrozen(value) || !Array.isArray(value.fields) ||
        !Object.isFrozen(value.fields) || value.fields.length !== type.fields.length) fail('struct value shape');
  }
  if (value.nullableType) {
    const type = ownedTable(context, value.nullableType);
    if (!type.flags.nullable || !type.nullableType || !Object.isFrozen(value) || typeof value.hasValue !== 'boolean' ||
        !value.hasValue && value.value !== null || value.hasValue && value.value === null) fail('Nullable shape');
    if (value.hasValue && value.value?.valueType && value.value.valueType !== type.nullableType) fail('Nullable payload type');
  }
}
