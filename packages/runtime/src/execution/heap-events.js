import {RuntimeEventName} from './runtime-events.js';

// Host observations never become part of a heap or guest snapshot.
const observers = new WeakMap();

export function initializeHeapEvents(vm) {
  const log = vm.runtimeEvents;
  if (log) observers.set(vm.heap, {vm, log});
}

export function beginHeapCollection(heap) {
  const observer = observers.get(heap);
  if (!observer || observer.vm.heap !== heap) return;
  observer.log.emit(RuntimeEventName.GCStart, {collection: heap.stats.collections + 1,
    liveBytes: heap.stats.liveBytes, liveObjects: heap.stats.liveObjects}, observer.vm.instructions);
}

export function endHeapCollection(heap, result) {
  const observer = observers.get(heap);
  if (!observer || observer.vm.heap !== heap) return;
  observer.log.emit(RuntimeEventName.GCEnd, {collection: result.collections,
    liveBytes: result.liveBytes, liveObjects: result.liveObjects,
    freedObjects: result.freedThisCollection, freedBytes: result.bytesThisCollection}, observer.vm.instructions);
}
