import {gcBoolean, gcInteger, gcInt64} from './api-arguments.js';
import {emptyGCMemoryInfo, GCKind} from './memory-info.js';

/** Return managed live bytes as an Int64, optionally after a full blocking collection. */
export function gcGetTotalMemory(heap, forceFullCollection = false) {
  if (gcBoolean(forceFullCollection, 'forceFullCollection')) {
    heap.collect([], {generation: 2, blocking: true, reason: 'Induced'});
  }
  return gcInt64(heap.stats.liveBytes);
}

/** Cumulative allocated bytes are exact and never reduced by collection. */
export function gcGetTotalAllocatedBytes(heap, precise = false) {
  gcBoolean(precise, 'precise');
  return gcInt64(heap.allocatedBytes64 ?? heap.stats.allocatedBytes64 ?? heap.stats.allocatedBytes);
}

/** Logical managed threads have independent allocation totals. */
export function gcGetAllocatedBytesForCurrentThread(heap, threadId = heap.currentThreadId?.() ?? 0) {
  return gcInt64(heap.settings.threadAllocatedBytes.get(threadId) ?? 0n);
}

/** Return an immutable snapshot of the most recent completed collection of the given kind. */
export function gcGetGCMemoryInfo(heap, kind = GCKind.Any) {
  gcInteger(kind, 'kind', 0, 3);
  return heap.settings.memoryInfo.get(kind) ?? emptyGCMemoryInfo();
}

/** Materialize scalar and generation data using GC-visible platform storage. */
export function managedGCMemoryInfo(platform, kind = GCKind.Any) {
  const info = gcGetGCMemoryInfo(platform.heap, kind);
  return platform.heap.withRoots([], () => {
    const generations = [];
    for (const generation of info.GenerationInfo) {
      const reference = platform.make('System.GCGenerationInfo', generation);
      platform.heap.pinRoot(reference);
      generations.push(reference);
    }
    const generationInfo = platform.heap.allocate('array', 'System.GCGenerationInfo[]', generations);
    platform.heap.pinRoot(generationInfo);
    const generationSpan = platform.make('System.ReadOnlySpan`1<System.GCGenerationInfo>', {$data: generationInfo});
    platform.heap.pinRoot(generationSpan);
    const pauses = [];
    for (const duration of info.PauseDurations) {
      const reference = platform.make('System.TimeSpan', {TotalMilliseconds: platform.managed(duration, 'double')});
      platform.heap.pinRoot(reference);
      pauses.push(reference);
    }
    const pauseDurations = platform.heap.allocate('array', 'System.TimeSpan[]', pauses);
    platform.heap.pinRoot(pauseDurations);
    const pauseSpan = platform.make('System.ReadOnlySpan`1<System.TimeSpan>', {$data: pauseDurations});
    platform.heap.pinRoot(pauseSpan);
    return platform.make('System.GCMemoryInfo', {
      ...info, GenerationInfo: generationSpan, PauseDurations: pauseSpan,
      PauseTimePercentage: platform.managed(info.PauseTimePercentage, 'double'),
      Compacted: platform.managed(info.Compacted, 'bool'), Concurrent: platform.managed(info.Concurrent, 'bool')
    });
  });
}
