function bytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Memory sampling canceled', 'AbortError');
}

/** Sample host accounting separately from managed estimates; unavailable APIs stay explicit. */
export async function sampleHostMemory({environment = globalThis, includeUserAgent = false, signal = null} = {}) {
  abort(signal);
  const failures = [];
  const performance = environment.performance;
  if (includeUserAgent && typeof performance?.measureUserAgentSpecificMemory === 'function') {
    try {
      const sample = await performance.measureUserAgentSpecificMemory();
      abort(signal);
      const used = bytes(sample?.bytes);
      if (used === null) throw new TypeError('User-agent memory measurement returned invalid bytes');
      return {available: true, source: 'performance.measureUserAgentSpecificMemory', scope: 'agent-cluster',
        hostUsedBytes: used, hostHeapUsedBytes: null, hostHeapTotalBytes: null, hostResidentBytes: null, failures};
    } catch (error) {
      abort(signal);
      failures.push({source: 'performance.measureUserAgentSpecificMemory', reason: String(error?.message ?? error)});
    }
  }
  if (typeof environment.process?.memoryUsage === 'function') {
    try {
      const sample = environment.process.memoryUsage();
      const used = bytes(sample.heapUsed);
      if (used === null) throw new TypeError('Process memory measurement returned invalid heap bytes');
      return {available: true, source: 'process.memoryUsage', scope: 'process', hostUsedBytes: used,
        hostHeapUsedBytes: used, hostHeapTotalBytes: bytes(sample.heapTotal), hostResidentBytes: bytes(sample.rss),
        hostExternalBytes: bytes(sample.external), hostArrayBufferBytes: bytes(sample.arrayBuffers), failures};
    } catch (error) {
      failures.push({source: 'process.memoryUsage', reason: String(error?.message ?? error)});
    }
  }
  if (performance?.memory) {
    const sample = performance.memory;
    const used = bytes(sample.usedJSHeapSize);
    if (used !== null) {
      return {available: true, source: 'performance.memory', scope: 'browser-js-heap', hostUsedBytes: used,
        hostHeapUsedBytes: used, hostHeapTotalBytes: bytes(sample.totalJSHeapSize),
        hostHeapLimitBytes: bytes(sample.jsHeapSizeLimit), hostResidentBytes: null, failures};
    }
    failures.push({source: 'performance.memory', reason: 'Browser returned invalid heap bytes'});
  }
  return {available: false, source: null, scope: null, hostUsedBytes: null, hostHeapUsedBytes: null,
    hostHeapTotalBytes: null, hostResidentBytes: null, failures,
    reason: failures.length ? 'Host memory APIs failed' : 'Host memory accounting is unavailable on this platform'};
}

/** Signed host deltas include host GC/JIT activity and are not object-size ground truth. */
export function compareMemorySamples(before, after, {managedBeforeBytes = 0, managedAfterBytes = 0} = {}) {
  if (![managedBeforeBytes, managedAfterBytes].every(value => Number.isFinite(value) && value >= 0)) {
    throw new RangeError('Managed memory estimates must be non-negative bytes');
  }
  const comparable = before?.available === true && after?.available === true && before.source === after.source;
  const managedDeltaBytes = managedAfterBytes - managedBeforeBytes;
  const hostDeltaBytes = comparable ? after.hostUsedBytes - before.hostUsedBytes : null;
  const estimateDifferenceBytes = comparable ? managedDeltaBytes - hostDeltaBytes : null;
  return {managedEstimateBytes: managedAfterBytes, managedDeltaBytes,
    hostUsedBytes: after?.hostUsedBytes ?? null, hostDeltaBytes, hostSource: after?.source ?? null,
    estimateDifferenceBytes, relativeEstimateDifference: hostDeltaBytes > 0 ? estimateDifferenceBytes / hostDeltaBytes : null,
    comparable, note: 'Managed bytes are logical estimates. Host deltas include runtime, JIT, bookkeeping and host GC.'};
}
