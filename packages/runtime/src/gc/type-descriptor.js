import {fieldStorageSize, valueSize} from './sizing.js';

function containsReferences(type) {
  if (type.flags.pointer || type.flags.byRef) return false;
  if (!type.flags.valueType) return true;
  // Framework value types without an inline layout use managed boxed slots.
  // Primitive/enum codecs still contain no references regardless of metadata flags.
  if (type.flags.primitive || type.enumUnderlyingType) return false;
  if (type.flags.dynamic) return true;
  return type.gcBitmap?.some(Boolean) ?? false;
}

/** Cached immutable layout descriptors separate GC reference maps from method dispatch. */
export class TypeDescriptors {
  constructor({pointerSize = 8, storageFor = null} = {}) {
    if (pointerSize !== 4 && pointerSize !== 8) throw new RangeError('pointerSize must be 4 or 8 bytes');
    if (storageFor !== null && typeof storageFor !== 'function') throw new TypeError('storageFor must be a function');
    this.pointerSize = pointerSize;
    this.storageFor = storageFor;
    this.cache = new WeakMap();
  }

  get(kind, methodTable) {
    let kinds = this.cache.get(methodTable);
    if (!kinds) this.cache.set(methodTable, kinds = new Map());
    if (kinds.has(kind)) return kinds.get(kind);
    const descriptor = this.create(kind, methodTable);
    kinds.set(kind, descriptor);
    return descriptor;
  }

  create(kind, table) {
    let scan = 'none';
    let referenceSlots = [];
    const dynamic = !['string', 'array', 'box'].includes(kind) && (table.flags.dynamic || kind !== 'object');
    if (kind === 'array') scan = containsReferences(table.elementType ?? table) ? 'all' : 'none';
    else if (kind !== 'string') {
      if (dynamic) scan = 'all';
      else if (kind === 'box') scan = containsReferences(table) ? 'all' : 'none';
      else {
        referenceSlots = table.fields.flatMap((field, index) => containsReferences(field.type) ? [index] : []);
        scan = referenceSlots.length ? 'bitmap' : 'none';
      }
    }
    const descriptor = {
      kind, methodTable: table, pointerSize: this.pointerSize, scan, storageFor: this.storageFor,
      referenceSlots: Object.freeze(referenceSlots), dynamic,
      elementType: table.elementType ?? null,
      elementSize: kind === 'array' ? valueSize(table.elementType ?? table, this.pointerSize) : 0,
      instanceSize: this.pointerSize * 2 + (kind === 'box'
        ? valueSize(table, this.pointerSize) : fieldStorageSize(table, this.pointerSize))
    };
    return Object.freeze(descriptor);
  }
}

/** Cursor is an edge ordinal; primitive arrays are skipped in constant time. */
export function visitEdgeRange(record, start, limit, visitor, result = {}) {
  const descriptor = record.descriptor;
  if (descriptor.scan === 'none') {
    result.next = 0;
    result.done = true;
    result.examined = 0;
    return result;
  }
  const bitmap = descriptor.scan === 'bitmap';
  // Prepared slot storage can be read directly once per chunk. Allocation preflight
  // and standalone descriptors retain their ordinary indexed-data representation.
  const binding = record.storage ? descriptor.storageFor?.(record) : null;
  const direct = binding && record.data === binding.view && binding.arena.values;
  const values = direct || record.data;
  const begin = direct ? binding.block.offset / 8 : 0;
  const length = bitmap ? descriptor.referenceSlots.length : binding?.length ?? values.length;
  const end = Math.min(length, start + limit);
  for (let cursor = start; cursor < end; cursor++) {
    const index = bitmap ? descriptor.referenceSlots[cursor] : cursor;
    visitor(values[begin + index], index);
  }
  result.next = end;
  result.done = end >= length;
  result.examined = end - start;
  return result;
}

export function visitEdges(record, visitor) {
  return visitEdgeRange(record, 0, Number.MAX_SAFE_INTEGER, visitor).examined;
}
