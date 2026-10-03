const primitiveSizes = Object.freeze({
  'System.Boolean': 1, 'System.Byte': 1, 'System.SByte': 1,
  'System.Char': 2, 'System.Int16': 2, 'System.UInt16': 2,
  'System.Int32': 4, 'System.UInt32': 4, 'System.Single': 4,
  'System.Int64': 8, 'System.UInt64': 8, 'System.Double': 8,
  'System.Decimal': 16
});

export function alignSize(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

/** Logical CLR-style storage width, independent of JavaScript host memory consumption. */
export function valueSize(type, pointerSize = 8, active = new Set()) {
  if (type.name === 'System.IntPtr' || type.name === 'System.UIntPtr' || type.flags.pointer || type.flags.byRef) {
    return pointerSize;
  }
  if (primitiveSizes[type.name] !== undefined) return primitiveSizes[type.name];
  if (type.enumUnderlyingType) return valueSize(type.enumUnderlyingType, pointerSize, active);
  if (!type.flags.valueType) return pointerSize;
  if (active.has(type)) throw new TypeError('Recursive inline value-type layout');
  active.add(type);
  let offset = 0;
  let alignment = 1;
  for (const field of type.fields) {
    const size = valueSize(field.type, pointerSize, active);
    const fieldAlignment = Math.min(Math.max(1, size), pointerSize);
    alignment = Math.max(alignment, fieldAlignment);
    offset = alignSize(offset, fieldAlignment) + size;
  }
  active.delete(type);
  return Math.max(1, alignSize(offset, alignment));
}

export function fieldStorageSize(type, pointerSize) {
  let offset = 0;
  for (const field of type.fields) {
    const width = valueSize(field.type, pointerSize);
    offset = alignSize(offset, Math.min(Math.max(1, width), pointerSize)) + width;
  }
  return offset;
}

/** Sizes include sync block, method table, CLR minimum size and pointer alignment. */
export function recordSize(descriptor, length) {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid managed storage length');
  const pointerSize = descriptor.pointerSize;
  let bytes;
  if (descriptor.kind === 'string') bytes = pointerSize * 2 + 4 + (length + 1) * 2;
  else if (descriptor.kind === 'array') {
    bytes = alignSize(pointerSize * 2 + 4, pointerSize) + descriptor.elementSize * length;
  } else if (descriptor.dynamic) bytes = pointerSize * 2 + length * pointerSize;
  else bytes = descriptor.instanceSize;
  bytes = Math.max(pointerSize * 3, alignSize(bytes, pointerSize));
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Managed object size is outside the safe integer range');
  return bytes;
}

export {primitiveSizes};
