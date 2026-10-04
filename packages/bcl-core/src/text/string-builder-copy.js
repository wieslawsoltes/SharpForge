import {fail, string} from '../host.js';

/** Register the native array CopyTo signature at the ordered A07 append point. */
export function registerStringBuilderCopyExtensions({member}) {
  member('System.Text.StringBuilder', 'CopyTo', ['int', 'char[]', 'int', 'int'], 'void');
}

const isInt32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function outOfRange(platform, parameter) {
  fail(platform, 'ArgumentOutOfRangeException', "Value is outside the supported range. (Parameter '" + parameter + "')");
}

function validateCopy(platform, length, values, scalars) {
  const destination = values[1];
  if (destination === null) fail(platform, 'ArgumentNullException', "Destination is required. (Parameter 'destination')");
  const record = platform.heap.get(destination);
  if (record.kind !== 'array' || record.methodTable.name !== 'System.Char[]') {
    fail(platform, 'ArgumentException', 'Destination must be a character array');
  }
  const [sourceIndex, , destinationIndex, count] = scalars;
  if (!isInt32(destinationIndex) || destinationIndex < 0) outOfRange(platform, 'destinationIndex');
  if (!isInt32(count)) outOfRange(platform, 'count');
  // The native array overload subtracts unchecked Int32 values before slicing or validating count/sourceIndex.
  if (destinationIndex > ((record.data.length - count) | 0)) fail(platform, 'ArgumentException', 'Destination array is too short');
  if (destinationIndex > record.data.length) fail(platform, 'ArgumentOutOfRangeException', 'Destination slice starts outside the array');
  if (count < 0) outOfRange(platform, 'count');
  if (!isInt32(sourceIndex) || sourceIndex < 0 || sourceIndex > length) outOfRange(platform, 'sourceIndex');
  if (count > length - sourceIndex) fail(platform, 'ArgumentException', 'Source range exceeds the builder length');
  if (count === 0) return null;
  return {destination, record, sourceIndex, destinationIndex, count};
}

function writeCharacter(platform, destination, record, index, value) {
  const oldValue = record.data[index];
  record.data[index] = value;
  if (platform.vm.notifyWrite) {
    platform.vm.notifyWrite({kind: 'array', handle: destination.h, generation: destination.g, index, oldValue, value});
  } else {
    platform.heap.mutationRevision++;
  }
}

function copyChunks(platform, roots, range) {
  let offset = range.sourceIndex;
  let target = range.destinationIndex;
  let remaining = range.count;
  for (let index = 1; index < roots.length && remaining > 0; index++) {
    const text = string(platform, roots[index]);
    if (offset >= text.length) {
      offset -= text.length;
      continue;
    }
    const count = Math.min(remaining, text.length - offset);
    for (let unit = 0; unit < count; unit++) {
      writeCharacter(platform, range.destination, range.record, target++, text.charCodeAt(offset + unit));
    }
    remaining -= count;
    offset = 0;
  }
  return null;
}

/** Copy UTF-16 units in one chunk traversal; observer source changes cannot alter the pinned original chunk snapshot. */
export function copyBuilderCharacters(platform, reference, values, scalars) {
  const range = validateCopy(platform, platform.get(reference, '$length', 0), values, scalars);
  if (!range) return null;
  const count = platform.get(reference, '$count', 0);
  const items = platform.heap.get(platform.get(reference, '$data')).data;
  const roots = new Array(count + 1);
  roots[0] = range.destination;
  for (let index = 0; index < count; index++) roots[index + 1] = items[index];
  return platform.heap.withRoots(roots, () => copyChunks(platform, roots, range));
}
