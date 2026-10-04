const begin = 'A05_FLOAT_TRACE_BEGIN';
const end = 'A05_FLOAT_TRACE_END';
const resultPrefix = 'A05_FLOAT_RESULT ';

function collection(line) {
  if (!/^\[\d+:0x[0-9a-f]+(?::\d+)?\]/i.test(line) || !/\bgc=\S+/.test(line)) return null;
  const fields = Object.fromEntries([...line.matchAll(/\b([\w.]+)=([^\s]+)/g)].map(match => [match[1], match[2]]));
  const allocated = Number(fields.allocated);
  if (!Number.isSafeInteger(allocated) || allocated < 0) throw new Error('V8 trace has no valid allocated byte count');
  return {kind: fields.gc, reportedAllocatedBytes: allocated, raw: line};
}

/** Keep V8's reported bytes separate from exact float-factory object counts. */
export function parseFloatAllocationTrace(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > 32 * 1024 * 1024) throw new RangeError('Invalid float trace size');
  let phase = 'before';
  let before = null;
  let after = null;
  let result = null;
  const during = [];
  for (const line of output.split(/\r?\n/)) {
    if (line === begin) {
      if (phase !== 'before' || !before) throw new Error('Missing initial full GC or duplicate float trace begin');
      phase = 'during';
    } else if (line === end) {
      if (phase !== 'during') throw new Error('Unmatched float trace end');
      phase = 'after';
    } else if (line.startsWith(resultPrefix)) {
      if (result || phase !== 'after') throw new Error('Unmatched float result');
      result = JSON.parse(line.slice(resultPrefix.length));
    } else {
      const event = collection(line);
      if (!event) continue;
      if (phase === 'before') before = event;
      else if (phase === 'during') during.push(event);
      else after ??= event;
    }
  }
  if (!after || !result || !result.outputVerified || !Number.isSafeInteger(result.floatCarriers) || result.floatCarriers < 0) {
    throw new Error('Incomplete float trace or allocation counter evidence');
  }
  const bytes = during.reduce((sum, event) => sum + event.reportedAllocatedBytes, after.reportedAllocatedBytes);
  return {...result, trace: {collectionsDuringLoop: during.length, reportedAllocatedBytes: bytes,
    initialCollection: before, loopCollections: during, closingCollection: after}};
}

/** Strictly no positive growth against the same warmed zero-iteration slice; retain inconclusive fixed costs. */
export function assessFloatAllocation(control, samples) {
  if (control.iterations !== 0 || !samples.length || samples.some(row => row.mode !== control.mode || row.iterations <= 0 ||
      row.warmupIterations !== control.warmupIterations || row.warmupSlices !== control.warmupSlices)) {
    throw new Error('A matching zero-iteration control and positive samples are required');
  }
  const rows = samples.map(row => ({iterations: row.iterations, floatCarriers: row.floatCarriers,
    collectionsDuringLoop: row.trace.collectionsDuringLoop,
    reportedBytesAboveControl: row.trace.reportedAllocatedBytes - control.trace.reportedAllocatedBytes,
    managedAllocations: row.managedAllocations, framesAllocated: row.framesAllocated, frameArraysAllocated: row.frameArraysAllocated}));
  const carriers = rows.every(row => row.floatCarriers === 0);
  const noGuestStorage = rows.every(row => row.managedAllocations === 0 && row.framesAllocated === 0 && row.frameArraysAllocated === 0);
  const noGrowth = rows.every(row => row.reportedBytesAboveControl <= 0 && row.collectionsDuringLoop === 0);
  return {floatCarrierAcceptance: carriers ? 'met' : 'missed',
    hostAllocationObservation: carriers && noGuestStorage && noGrowth ? 'no-observed-growth' : 'allocation-or-noise-observed',
    totalJSObjectAcceptance: 'unqualified',
    reason: 'The exact counter covers every float() carrier. V8 GC bytes/events include other host work and do not count all JS objects.',
    observations: rows};
}
