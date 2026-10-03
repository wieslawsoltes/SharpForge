import {ManagedFault} from './fault.js';
import {gcBoolean, gcInteger} from './api-arguments.js';

export const GCCollectionMode = Object.freeze({Default: 0, Forced: 1, Optimized: 2, Aggressive: 3});
export const GC_MAX_GENERATION = 2;

/** Collect generations 0..generation; compaction always requires a blocking cycle. */
export function gcCollect(heap, {generation = 2, mode = 0, blocking = true, compacting = mode === 3 && generation === 2} = {}) {
  gcInteger(generation, 'generation', 0, GC_MAX_GENERATION);
  gcInteger(mode, 'mode', 0, GCCollectionMode.Aggressive);
  blocking = gcBoolean(blocking, 'blocking');
  compacting = gcBoolean(compacting, 'compacting');
  if (mode === GCCollectionMode.Aggressive) {
    if (generation !== GC_MAX_GENERATION || !blocking || !compacting) {
      throw new ManagedFault('ArgumentException', 'Aggressive collections require generation 2, blocking=true and compacting=true');
    }
  }
  if (compacting) blocking = true;
  const policy = heap.settings?.collectionPolicy();
  if (policy && !policy.incremental) blocking = true;
  if (mode === GCCollectionMode.Optimized && heap.stats.liveBytes < heap.threshold && !compacting) return null;
  const reason = compacting ? 'InducedCompacting' : mode === GCCollectionMode.Optimized ? 'InducedNotForced' : 'Induced';
  heap.collect([], {generation, mode, blocking, compacting, reason});
  return null;
}

/** CollectionCount counts collections including the requested generation, not live objects. */
export function gcCollectionCount(heap, generation) {
  gcInteger(generation, 'generation', 0, GC_MAX_GENERATION);
  return heap.stats.generationCollections?.[generation] ?? heap.stats.collections;
}

/** Logical reference identities and collection generations are separate quantities. */
export function gcGetGeneration(heap, reference) {
  if (reference === null || reference === undefined) throw new ManagedFault('ArgumentNullException', 'Object cannot be null');
  return heap.getGeneration(reference);
}
