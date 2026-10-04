import {fail} from '@sharpforge/bcl-core';
import {ACTIVE_SLOT, count, data, version} from './legacy-storage.js';

function moveNext(p, reference, owner) {
  const slots = p.get(owner, '$slots');
  const states = slots ? p.heap.get(slots).data : null;
  const length = states ? p.get(owner, '$used', 0) : count(p, owner);
  let index = p.get(reference, '$index', -1) + 1;
  while (states && index < length && states[index] !== ACTIVE_SLOT) index++;
  p.set(reference, '$index', index);
  return p.managed(index < length, 'bool');
}

function current(p, reference, owner) {
  const index = p.get(reference, '$index', -1);
  const slots = p.get(owner, '$slots');
  const states = slots ? p.heap.get(slots).data : null;
  const length = states ? p.get(owner, '$used', 0) : count(p, owner);
  if (index < 0 || index >= length || states && states[index] !== ACTIVE_SLOT) {
    fail(p, 'InvalidOperationException', 'Enumerator is not positioned on an item');
  }
  const type = p.bclHost.frameworkType(p.record(owner).type);
  const position = type.family === 'Stack' ? count(p, owner) - 1 - index
    : type.family === 'Queue' ? (p.get(owner, '$head', 0) + index) % data(p, owner).length : index;
  return data(p, owner)[position];
}

/** Preserve released disposal/version rules while indexed owners advance across vacant slots. */
export function collectionEnumerator(p, descriptor, reference) {
  const method = descriptor.name;
  if (method === 'Dispose') {
    p.set(reference, '$owner', null);
    return null;
  }
  const owner = p.get(reference, '$owner');
  if (!owner) fail(p, 'ObjectDisposedException', 'Enumerator is disposed');
  if (version(p, owner) !== p.get(reference, '$version')) {
    fail(p, 'InvalidOperationException', 'Collection was modified during enumeration');
  }
  if (method === 'MoveNext') return moveNext(p, reference, owner);
  if (method === 'get_Current') return current(p, reference, owner);
  fail(p, 'MissingMethodException', descriptor.owner + '.' + method);
}
