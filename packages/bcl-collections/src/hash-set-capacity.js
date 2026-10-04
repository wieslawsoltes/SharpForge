import {MAX, fail, integer, makeArray} from '@sharpforge/bcl-core';
import {ACTIVE_SLOT, count, data, positions, version} from './legacy-storage.js';
import {hashSetActive, notifyHashSetVersion, hashSetStorageCheckpoint, checkHashSetStorage} from './hash-set-storage-state.js';

// The .NET 10.0.5 HashHelpers table through the first capacity beyond this profile's array limit.
const primes = Object.freeze([
  3, 7, 11, 17, 23, 29, 37, 47, 59, 71, 89, 107, 131, 163, 197, 239, 293, 353, 431, 521, 631, 761, 919,
  1103, 1327, 1597, 1931, 2333, 2801, 3371, 4049, 4861, 5839, 7013, 8419, 10103, 12143, 14591,
  17519, 21023, 25229, 30293, 36353, 43627, 52361, 62851, 75431, 90523, 108631, 130363, 156437,
  187751, 225307, 270371, 324449, 389357, 467237, 560689, 672827, 807403, 968897, 1162687
]);

const maxInt = 2_147_483_647;

function roundedCapacity(minimum) {
  return primes.find(prime => prime >= minimum) ?? Infinity;
}

function boundedCapacity(platform, minimum) {
  const capacity = roundedCapacity(minimum);
  if (capacity > MAX) {
    fail(platform, 'OutOfMemoryException',
      'BCLHS0001: HashSet capacity exceeds the one-million-element backing-array limit');
  }
  return capacity;
}

function publishStorage(platform, reference, storage, slots, layout) {
  const record = platform.record(reference);
  const fields = new Map();
  for (let index = 0; index < record.data.length; index += 2) fields.set(record.data[index], index);
  const next = [...record.data];
  const writes = [];
  for (const [property, value] of Object.entries({'$data': storage, '$slots': slots, ...layout.state})) {
    const index = fields.get(property) ?? next.length;
    const oldValue = fields.has(property) ? next[index + 1] : null;
    next[index] = property;
    next[index + 1] = value;
    writes.push({kind: 'field', handle: reference.h, generation: reference.g, index: index + 1, property, value, oldValue});
  }
  // Detached backing arrays remain readable as event.oldValue until the whole notification batch completes.
  return platform.heap.withRoots(writes.map(write => write.oldValue), () => {
    const expected = hashSetStorageCheckpoint(platform, reference, next);
    // Owner growth may itself notify during replaceData; it must never expose a stale compaction index.
    if (layout.invalidateIndex) platform.bclIndexes?.delete(record);
    // Publish the complete tuple before observers can collect, throw, or read the new slot layout.
    platform.heap.replaceData(reference, next);
    if (!checkHashSetStorage(platform, reference, expected)) return false;
    const committed = hashSetStorageCheckpoint(platform, reference);
    for (const write of writes) {
      platform.vm.notifyWrite?.(write);
      if (!checkHashSetStorage(platform, reference, committed)) return false;
    }
    return true;
  });
}

function installStorage(platform, reference, layout) {
  const {items, slots, retainStorage = false} = layout;
  const checkpoint = hashSetStorageCheckpoint(platform, reference);
  try {
    return platform.heap.withRoots([reference], () => {
      const storage = retainStorage ? platform.get(reference, '$data') : makeArray(platform, 'object', items);
      if (!checkHashSetStorage(platform, reference, checkpoint)) return false;
      return platform.heap.withRoots([storage], () => {
        const markers = makeArray(platform, 'int', slots);
        if (!checkHashSetStorage(platform, reference, checkpoint)) return false;
        return platform.heap.withRoots([markers], () => publishStorage(platform, reference, storage, markers, layout));
      });
    });
  } catch (error) {
    if (!hashSetActive(platform)) return false;
    throw error;
  }
}

function growStorage(platform, reference, capacity) {
  if (!hashSetActive(platform)) return false;
  const previous = data(platform, reference);
  const markerReference = platform.get(reference, '$slots');
  const markers = markerReference ? platform.heap.get(markerReference).data : [];
  if (previous.length >= capacity && markers.length >= capacity) return true;
  const items = previous.concat(Array(capacity - previous.length).fill(null));
  const slots = new Int32Array(capacity).fill(-1);
  slots.set(markers);
  if (!markerReference) slots.fill(ACTIVE_SLOT, 0, count(platform, reference));
  return installStorage(platform, reference, {
    items, slots, retainStorage: previous.length === capacity,
    state: {
      '$used': platform.get(reference, '$used', count(platform, reference)),
      '$free': platform.get(reference, '$free', -1)
    }
  });
}

/** Constructor and single-insert growth retain slots and use native prime capacities. */
export function reserveHashSet(platform, reference, needed) {
  if (!hashSetActive(platform)) return false;
  integer(platform, needed);
  const capacity = data(platform, reference).length;
  const next = needed > capacity ? boundedCapacity(platform, capacity ? Math.max(needed, capacity * 2) : needed) : capacity;
  return growStorage(platform, reference, next);
}

/** Preallocate a bulk union's final native growth capacity before its first mutation. */
export function reserveHashSetUnion(platform, reference, needed) {
  if (!hashSetActive(platform)) return false;
  integer(platform, needed);
  let capacity = data(platform, reference).length;
  if (needed > capacity) {
    capacity ||= boundedCapacity(platform, 0);
    while (capacity < needed) capacity = boundedCapacity(platform, capacity * 2);
  }
  return growStorage(platform, reference, capacity);
}

function ensureCapacity(platform, reference, requested) {
  if (!hashSetActive(platform)) return null;
  integer(platform, requested, 0, maxInt);
  const current = data(platform, reference).length;
  if (requested <= current) return current;
  const capacity = boundedCapacity(platform, requested);
  return growStorage(platform, reference, capacity) ? capacity : null;
}

/** Compact live slots only when the rounded requested capacity actually shrinks storage. */
export function trimHashSet(platform, reference, requested) {
  if (!hashSetActive(platform)) return null;
  if (requested === undefined) requested = count(platform, reference);
  integer(platform, requested, count(platform, reference), maxInt);
  const previousCapacity = data(platform, reference).length;
  if (requested >= previousCapacity) return null;
  const capacity = roundedCapacity(requested);
  if (capacity >= previousCapacity) return null;
  // Native TrimExcess advances its version before allocating; even a failed shrink invalidates enumeration.
  if (!notifyHashSetVersion(platform, reference, version(platform, reference) + 1)) return null;
  // A host write observer can mutate this set. Re-read its state instead of publishing a stale layout.
  integer(platform, requested, count(platform, reference), maxInt);
  const current = data(platform, reference);
  if (capacity >= current.length) return null;
  const items = Array(capacity).fill(null);
  let used = 0;
  for (const position of positions(platform, reference)) items[used++] = current[position];
  const slots = Array(capacity).fill(-1);
  slots.fill(ACTIVE_SLOT, 0, used);
  installStorage(platform, reference, {
    items, slots, state: {'$used': used, '$free': -1}, invalidateIndex: true
  });
  return null;
}

/** Dispatch only the complete capacity family; all counts are Int32 element counts. */
export function hashSetCapacity(platform, descriptor, context) {
  const {reference, native} = context;
  if (descriptor.name === 'get_Capacity') return data(platform, reference).length;
  if (descriptor.name === 'EnsureCapacity') return ensureCapacity(platform, reference, native[0]);
  return trimHashSet(platform, reference, descriptor.parameters.length ? native[0] : undefined);
}

/** Append A08 contracts after every released member, including the existing ordering extension. */
export function registerHashSetCapacity(registry) {
  for (const element of ['int', 'double', 'bool', 'string', 'object']) {
    const owner = `System.Collections.Generic.HashSet\`1<${element}>`;
    registry.prop(owner, 'Capacity', 'int', 0, true);
    registry.member(owner, 'EnsureCapacity', ['int'], 'int');
    registry.member(owner, 'TrimExcess', [], 'void');
    registry.member(owner, 'TrimExcess', ['int'], 'void');
  }
}
