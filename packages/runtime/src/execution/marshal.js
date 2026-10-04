import {CilError} from '@sharpforge/cil';
import {float} from './numeric-ops.js';

const ranges = Object.freeze({
  int: [-2147483648, 2147483647], uint: [0, 4294967295], short: [-32768, 32767],
  ushort: [0, 65535], byte: [0, 255], sbyte: [-128, 127], char: [0, 65535]
});

function marshalInteger64(value, type) {
  let result;
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('Unsafe integer');
    result = BigInt(value);
  } catch {
    throw new CilError('Int64 arguments require an exact integer or decimal string');
  }
  if (type === 'long' && (result < -(1n << 63n) || result >= (1n << 63n)) ||
      type === 'ulong' && (result < 0 || result >= (1n << 64n))) throw new CilError('Int64 argument out of range');
  return BigInt.asIntN(64, result);
}

/** Nested array marshaling roots each owner until every recursively allocated child is published. */
export function marshal(vm, value, type) {
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw new CilError(`Expected JSON array for ${type}`);
    const elementType = type.slice(0, -2);
    const reference = vm.heap.array(elementType, value.length);
    return vm.heap.withRoots([reference], () => {
      for (let index = 0; index < value.length; index++) vm.heap.writeElement(reference, index, marshal(vm, value[index], elementType));
      return reference;
    });
  }
  if (type === 'string') {
    if (value === null) return null;
    if (typeof value !== 'string') throw new CilError('Expected string argument');
    return vm.heap.string(value);
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new CilError('Expected boolean argument');
    return value ? 1 : 0;
  }
  if (type === 'long' || type === 'ulong') return marshalInteger64(value, type);
  if (type === 'double' || type === 'float') {
    if (typeof value !== 'number') throw new CilError('Expected numeric argument');
    return float(value, type === 'float' ? 'r4' : 'r8');
  }
  if (Object.hasOwn(ranges, type)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new CilError('Expected integer argument');
    const [minimum, maximum] = ranges[type];
    if (value < minimum || value > maximum) throw new CilError(`${type} argument out of range`);
    return value | 0;
  }
  if (type === 'object' && value === null) return null;
  throw new CilError(`Host argument type '${type}' is not supported`);
}
