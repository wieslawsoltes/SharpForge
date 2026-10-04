import {ManagedFault} from '../heap.js';
import {storageRead, storageWrite} from './array-storage.js';

export function numericArrayData(platform, reference) {
  const record = platform.heap.get(reference);
  if (record.kind !== 'array') throw new ManagedFault('ArgumentException', 'An array is required');
  return record.data;
}

export function numericArrayRange(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Index is outside the available range');
  }
  return value;
}

/** Numeric host results enter primitive backing without converting scalar carriers to NaN. */
export function numericArrayResult(platform, values) {
  if (typeof values === 'number') return platform.managed(values, 'double');
  const reference = platform.heap.array('double', values.length);
  return platform.heap.withRoots([reference], () => {
    const record = platform.heap.ensureWritable(reference);
    if (record.data instanceof Float64Array) record.data.set(values);
    else {
      for (let index = 0; index < values.length; index++) {
        storageWrite(record.data, index, platform.managed(values[index], 'double'));
      }
    }
    return reference;
  });
}

/** Copy only the selected vector lanes and expose managed values to write observers. */
export function copyVectorArray(platform, vector, destination, offset, lanes) {
  const record = platform.heap.get(destination);
  if (record.kind !== 'array') throw new ManagedFault('ArgumentException', 'An array is required');
  if (!Number.isInteger(offset) || offset < 0 || offset > record.data.length - lanes) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Index is outside the available range');
  }
  const data = platform.heap.ensureWritable(destination).data;
  for (let lane = 0; lane < lanes; lane++) {
    const index = offset + lane;
    const oldValue = storageRead(data, index, record.methodTable.elementType, {source: !platform.vm.inspector});
    const value = platform.get(vector, '$' + lane);
    storageWrite(data, index, value);
    platform.vm.notifyWrite({kind: 'array', handle: destination.h, generation: destination.g, index, value, oldValue});
  }
  return null;
}
