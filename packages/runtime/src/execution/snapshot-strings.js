import {ownsHeapReference} from './heap-reference.js';

/** A weak intern cache may retain expired handles; omit only owned dead entries from the detached captured pool. */
export function pruneWeakSnapshotStrings(vm, snapshot) {
  if (!vm.options.weakStringInterning || !(snapshot.strings instanceof Map)) return;
  for (const [text, reference] of snapshot.strings) {
    if (!ownsHeapReference(vm.heap, reference)) continue;
    if (snapshot.heap.generations[reference.h] !== reference.g || !snapshot.heap.records[reference.h]) {
      snapshot.strings.delete(text);
    }
  }
}
