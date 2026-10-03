import {ManagedFault} from './fault.js';

const modes = new Map([['Default', 0], ['Forced', 1], ['Optimized', 2], ['Aggressive', 3]]);

/** Normalize the GC.Collect overload without silently accepting contradictory modes. */
export function normalizeCollectionRequest(options = {}) {
  const generation = options.generation ?? 2;
  const mode = typeof options.mode === 'string' ? modes.get(options.mode) : options.mode ?? 0;
  const blocking = options.blocking ?? true;
  const compacting = options.compacting ?? false;
  if (!Number.isInteger(generation) || generation < 0 || generation > 2) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Collection generation must be between zero and two');
  }
  if (!Number.isInteger(mode) || mode < 0 || mode > 3 || typeof blocking !== 'boolean' || typeof compacting !== 'boolean') {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Invalid collection mode or flags');
  }
  if (mode === 3 && (generation !== 2 || !blocking || !compacting)) {
    throw new ManagedFault('ArgumentException', 'Aggressive collection requires a full blocking compacting collection');
  }
  return {...options, generation, mode, blocking, compacting, reason: options.reason ?? 'Induced'};
}

/** CompactOnce is consumed by GCSettings only after the full collection completes. */
export function shouldCompactLarge(settings, request = {}) {
  const mode = settings?.largeObjectHeapCompactionMode;
  return (request.generation ?? 2) === 2 &&
    (mode === 2 || mode === 'CompactOnce' || request.compactLarge === true || request.reason === 'OutOfMemory');
}

export function shouldCompact(request = {}, settings = null) {
  return (request.generation ?? 2) === 2 && (!!request.compacting || shouldCompactLarge(settings, request));
}
