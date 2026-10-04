import {formatDoubleDefault} from './formatting/double-format.js';
const numericTypes = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'nint', 'nuint', 'char', 'float', 'double', 'decimal', 'System.SByte', 'System.Byte', 'System.Int16',
  'System.UInt16', 'System.Int32', 'System.UInt32', 'System.Int64', 'System.UInt64', 'System.IntPtr',
  'System.UIntPtr', 'System.Char', 'System.Single', 'System.Double', 'System.Decimal']);


/** The legacy managed text/collection limit, measured in UTF-16 units or items. */
export const MAX = 1_000_000;

/** Raise a managed fault, optionally retaining an already-rooted managed exception reference. */
export function fail(platform, type, message, reference = null) {
  platform.bclHost.fault(type, message, reference);
  throw new Error('BCL host fault service must throw');
}

/** Validate an inclusive integer range; failures are managed range exceptions. */
export function integer(platform, value, minimum = 0, maximum = MAX) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(platform, 'ArgumentOutOfRangeException', 'Value is outside the supported range');
  }
  return value;
}

/** Unwrap managed boxes and strings, preserving opaque managed references. */
export function bclScalar(platform, value) {
  if (platform.bclHost.isReference(value)) {
    const record = platform.heap.get(value);
    if (record.kind === 'box') return bclScalar(platform, record.data[0]);
    if (record.kind === 'string') return record.data;
  }
  return platform.native(value);
}

/** Read a primitive's managed type without losing a box's declared type. */
export function typeOf(platform, value) {
  if (platform.bclHost.isReference(value)) {
    const record = platform.heap.get(value);
    return record.kind === 'string' ? 'string' : record.type;
  }
  if (typeof value === 'boolean') return 'bool';
  return typeof value === 'number' ? 'double' : 'object';
}

/** Format legacy scalar text using the engine only for opaque object values. */
export function text(platform, value, type) {
  const native = bclScalar(platform, value);
  if (native == null) return '';
  if (type === 'bool' || type === 'System.Boolean' || typeof native === 'boolean') return native ? 'True' : 'False';
  if (numericTypes.has(type)) {
    return platform.vm.format(value, type);
  }
  if (typeof native === 'number') return formatDoubleDefault(native);
  if (typeof native === 'string') return native;
  return platform.vm.format(value);
}

/** Require managed string content; nullable=true also accepts a null value. */
export function string(platform, value, nullable = false) {
  const native = bclScalar(platform, value);
  if (native === null && nullable) return null;
  if (typeof native !== 'string') {
    fail(platform, native === null ? 'ArgumentNullException' : 'ArgumentException', 'A string is required');
  }
  return native;
}

/** Enforce the text limit after an operation and return its UTF-16 string. */
export function bounded(platform, value) {
  if (value.length > MAX) fail(platform, 'OutOfMemoryException', 'BCL text limit exceeded');
  return value;
}

/** Return managed array storage; callers retain responsibility for rooting it. */
export function array(platform, reference) {
  const record = platform.heap.get(reference);
  if (record.kind !== 'array') fail(platform, 'ArgumentException', 'Array required');
  return record.data;
}

/** Allocate a bounded array, copying the caller's elements into managed storage. */
export function makeArray(platform, type, items) {
  integer(platform, items.length);
  return platform.heap.allocate('array', type + '[]', [...items]);
}

function scalarEqual(platform, first, second) {
  if (first === second || typeof first === 'number' && typeof second === 'number' &&
      Number.isNaN(first) && Number.isNaN(second)) return true;
  return platform.bclHost.isReference(first) && platform.bclHost.isReference(second) &&
    first.h === second.h && first.g === second.g;
}

/** Legacy scalar equality, including NaN and generation-qualified references. */
export function equal(platform, left, right) {
  if (left === right) return true;
  return scalarEqual(platform, bclScalar(platform, left), bclScalar(platform, right));
}

/** Legacy Array equality preserves each engine's native boxing interpretation. */
export function nativeEqual(platform, left, right) {
  return scalarEqual(platform, platform.native(left), platform.native(right));
}
