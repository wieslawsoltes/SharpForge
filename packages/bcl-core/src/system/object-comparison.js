import {bclScalar, fail} from '../host.js';

function sameReference(platform, left, right) {
  return left === right || platform.bclHost.isReference(left) && platform.bclHost.isReference(right) &&
    left.h === right.h && left.g === right.g;
}

function valueType(platform, value, hint) {
  if (hint?.flags.valueType) return hint;
  if (platform.bclHost.isReference(value)) return platform.heap.get(value).methodTable;
  const native = platform.native(value);
  const name = typeof native === 'boolean' ? 'bool' : typeof native === 'bigint' ? 'long' : 'double';
  return platform.heap.methodTables.get(name);
}

function unsupported(platform, type) {
  for (const implemented of type.interfaceMap.keys()) {
    if (implemented.name === 'System.IComparable') {
      fail(platform, 'NotSupportedException', 'Managed IComparable callbacks are tracked by #2655');
    }
  }
  fail(platform, 'ArgumentException', 'At least one object must implement IComparable');
}

/** Compare managed objects without erasing boxed types; a value-array hint avoids allocating boxes. */
export function compareObjects(platform, left, right, compareStrings, elementType = null) {
  if (sameReference(platform, left, right)) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const first = bclScalar(platform, left);
  const second = bclScalar(platform, right);
  if (typeof first === 'string' && typeof second === 'string') return compareStrings(first, second);
  const firstType = valueType(platform, left, elementType);
  const secondType = valueType(platform, right);
  if (!firstType.flags.primitive && !firstType.flags.enum && firstType.name !== 'System.String') {
    unsupported(platform, firstType);
  }
  if (firstType !== secondType) fail(platform, 'ArgumentException', 'Objects must have the same comparable type');
  if (first === second || Number.isNaN(first) && Number.isNaN(second)) return 0;
  if (Number.isNaN(first)) return -1;
  if (Number.isNaN(second)) return 1;
  return first < second ? -1 : 1;
}
