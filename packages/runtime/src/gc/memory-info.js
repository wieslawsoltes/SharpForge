import {gcInt64, INT64_MAX} from './api-arguments.js';

export const GCKind = Object.freeze({Any: 0, Ephemeral: 1, FullBlocking: 2, Background: 3});

function space(info, name) {
  return info?.[name] ?? info?.spaces?.[name] ?? {};
}

/** Five CLR-compatible generation slots: three small-object generations, LOH and POH. */
export function generationSizes(stats, spaces) {
  const generations = [...(stats.generationBytes ?? [stats.liveBytes ?? 0, 0, 0])];
  const large = space(spaces, 'large').liveBytes ?? 0;
  const pinned = space(spaces, 'pinned').liveBytes ?? 0;
  const frozen = space(spaces, 'frozen').liveBytes ?? 0;
  generations[2] = Math.max(0, generations[2] - large - pinned - frozen);
  return [...generations.slice(0, 3), large, pinned];
}

function fragmentation(spaces) {
  return [0, 0, space(spaces, 'small').fragmentedBytes ?? 0,
    space(spaces, 'large').fragmentedBytes ?? 0, space(spaces, 'pinned').fragmentedBytes ?? 0];
}

function pendingFinalizers(heap) {
  const finalizers = heap.lifetime?.finalizers;
  return finalizers?.pendingCount ?? finalizers?.pending?.length ?? heap.stats.finalizationPendingCount ?? 0;
}

/** Capture immutable completed-collection data; subsequent allocations cannot alter it. */
export function captureGCMemoryInfo(heap, stats, options = {}, before = null, elapsedMs = 0) {
  const spaces = heap.spaces?.memoryInfo?.() ?? {};
  const afterSizes = generationSizes(stats, spaces);
  const beforeSizes = generationSizes({generationBytes: before?.generationBytes ?? [0, 0, 0]}, before?.spaces);
  const beforeFragmentation = fragmentation(before?.spaces);
  const afterFragmentation = fragmentation(spaces);
  const generationInfo = afterSizes.map((bytes, index) => Object.freeze({
    SizeBeforeBytes: gcInt64(beforeSizes[index]), FragmentationBeforeBytes: gcInt64(beforeFragmentation[index]),
    SizeAfterBytes: gcInt64(bytes), FragmentationAfterBytes: gcInt64(afterFragmentation[index])
  }));
  const load = gcInt64(stats.liveBytes) + (heap.pressure?.bytes ?? 0n);
  const total = gcInt64(heap.maxBytes);
  const pause = Math.max(0, stats.lastPauseMs ?? 0);
  return Object.freeze({
    HighMemoryLoadThresholdBytes: total * 9n / 10n,
    MemoryLoadBytes: load > INT64_MAX ? INT64_MAX : load,
    TotalAvailableMemoryBytes: total,
    HeapSizeBytes: gcInt64(stats.liveBytes),
    FragmentedBytes: gcInt64(spaces.fragmentedBytes ?? 0),
    TotalCommittedBytes: gcInt64(spaces.reservedBytes ?? stats.liveBytes),
    PromotedBytes: gcInt64(stats.promotedBytesThisCollection ?? stats.promotedBytes ?? 0),
    PinnedObjectsCount: gcInt64(stats.pinnedObjects ?? space(spaces, 'pinned').objects ?? 0),
    FinalizationPendingCount: gcInt64(pendingFinalizers(heap)),
    Index: gcInt64(stats.collections),
    Generation: options.generation ?? 2,
    Compacted: Boolean(options.compacting),
    Concurrent: options.blocking === false,
    PauseTimePercentage: elapsedMs > 0 ? (stats.totalPauseMs ?? 0) / elapsedMs * 100 : 0,
    GenerationInfo: Object.freeze(generationInfo),
    PauseDurations: Object.freeze([pause, 0])
  });
}

/** .NET uses Index=0 and zero data when no collection of the requested kind exists. */
export function emptyGCMemoryInfo() {
  const generation = Object.freeze({SizeBeforeBytes: 0n, FragmentationBeforeBytes: 0n,
    SizeAfterBytes: 0n, FragmentationAfterBytes: 0n});
  return Object.freeze({
    HighMemoryLoadThresholdBytes: 0n, MemoryLoadBytes: 0n, TotalAvailableMemoryBytes: 0n,
    HeapSizeBytes: 0n, FragmentedBytes: 0n, TotalCommittedBytes: 0n, PromotedBytes: 0n,
    PinnedObjectsCount: 0n, FinalizationPendingCount: 0n, Index: 0n, Generation: 0,
    Compacted: false, Concurrent: false, PauseTimePercentage: 0,
    GenerationInfo: Object.freeze(Array(5).fill(generation)), PauseDurations: Object.freeze([0, 0])
  });
}
