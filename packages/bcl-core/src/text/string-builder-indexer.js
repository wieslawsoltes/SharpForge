import {fail, integer, string} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Register the native Chars accessors at the ordered A07 tail, without changing existing builder contracts. */
export function registerStringBuilderIndexerExtensions(registry) {
  registry.member(owner, 'get_Chars', ['int'], 'char');
  registry.member(owner, 'set_Chars', ['int', 'char'], 'void');
}

function replaceCharacter(platform, reference, location, unit) {
  const {storage, slot, offset, text, previous} = location;
  const replacement = platform.heap.string(text.slice(0, offset) + String.fromCharCode(unit) + text.slice(offset + 1));
  platform.heap.withRoots([storage, previous, replacement], () => {
    platform.heap.get(storage).data[slot] = replacement;
    platform.heap.mutationRevision++;
    platform.vm.notifyWrite?.({kind: 'array', handle: storage.h, generation: storage.g, index: slot,
      oldValue: previous, value: replacement});
    // A callback may clear or append to the builder; never restore a captured backing array or count afterward.
    platform.set(reference, '$version', platform.get(reference, '$version', 0) + 1);
  });
  return null;
}

/** Read one UTF-16 unit, or replace only its managed chunk; bounds preserve native getter/setter fault types. */
export function accessBuilderCharacter(platform, reference, values) {
  const index = values[0];
  const write = values.length === 2;
  const length = platform.get(reference, '$length', 0);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    fail(platform, write ? 'ArgumentOutOfRangeException' : 'IndexOutOfRangeException',
      write ? "Index must be within the builder length. (Parameter 'index')" : 'Index was outside the builder length');
  }
  const unit = write ? integer(platform, values[1], 0, 65535) : null;
  const storage = platform.get(reference, '$data');
  const items = platform.heap.get(storage).data;
  const count = platform.get(reference, '$count', 0);
  let offset = index;
  for (let slot = 0; slot < count; slot++) {
    const previous = items[slot];
    const text = string(platform, previous);
    if (offset < text.length) return write
      ? replaceCharacter(platform, reference, {storage, slot, offset, text, previous}, unit)
      : text.charCodeAt(offset);
    offset -= text.length;
  }
  fail(platform, 'IndexOutOfRangeException', 'Index was outside the builder chunks');
}
