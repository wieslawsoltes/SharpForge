import {fieldStorageSize, valueSize} from './sizing.js';

function containsReferences(type) {
  if (type.flags.pointer || type.flags.byRef) return false;
  if (!type.flags.valueType) return true;
  return type.gcBitmap?.some(Boolean) ?? false;
}

/** Cached immutable layout descriptors separate GC reference maps from method dispatch. */
export class TypeDescriptors {
  constructor({pointerSize = 8} = {}) {
    if (pointerSize !== 4 && pointerSize !== 8) throw new RangeError('pointerSize must be 4 or 8 bytes');
    this.pointerSize = pointerSize;
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
      kind, methodTable: table, pointerSize: this.pointerSize, scan,
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
  const length = bitmap ? descriptor.referenceSlots.length : record.data.length;
  const end = Math.min(length, start + limit);
  for (let cursor = start; cursor < end; cursor++) {
    const index = bitmap ? descriptor.referenceSlots[cursor] : cursor;
    visitor(record.data[index], index);
  }
  result.next = end;
  result.done = end >= length;
  result.examined = end - start;
  return result;
}

export function visitEdges(record, visitor) {
  return visitEdgeRange(record, 0, Number.MAX_SAFE_INTEGER, visitor).examined;
}
