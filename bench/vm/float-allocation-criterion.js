const criterion = 'A double-heavy loop allocates zero JS objects per iteration (measured by --trace-gc or allocation counter)';
const counters = ['floatCarriers', 'managedAllocations', 'framesAllocated', 'frameArraysAllocated'];
const environmentFields = ['node', 'v8', 'platform', 'arch'];
const instrumentationFields = ['path', 'beforeSHA256', 'afterSHA256', 'allocationSites'];

function sameFields(left, right, fields) {
  return fields.every(key => left?.[key] !== undefined && left[key] === right?.[key]);
}

function validRow(row, mode, iterations, warmup, exemplar) {
  return row?.mode === mode && row.iterations === iterations && row.warmupIterations === warmup && row.warmupSlices === 10 &&
    row.instructions === iterations * 11 && row.outputVerified === true &&
    counters.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0) &&
    sameFields(row.environment, exemplar.environment, environmentFields) &&
    sameFields(row.instrumentation, exemplar.instrumentation, instrumentationFields) && row.instrumentation.allocationSites === 1 &&
    Number.isSafeInteger(row.trace?.collectionsDuringLoop) && row.trace.collectionsDuringLoop >= 0 &&
    Number.isSafeInteger(row.trace?.reportedAllocatedBytes) && row.trace.reportedAllocatedBytes >= 0;
}

function observation(group) {
  const [short, long] = group.samples;
  const allocated = row => row.trace.reportedAllocatedBytes;
  return {mode: group.mode, iterations: [short.iterations, long.iterations],
    instructions: [short.instructions, long.instructions],
    intervalAllocatedBytes: [allocated(short), allocated(long)],
    zeroIterationAllocatedBytes: allocated(group.control),
    bytesAboveZeroIterationControl: [allocated(short) - allocated(group.control), allocated(long) - allocated(group.control)],
    incrementalAllocatedBytes: allocated(long) - allocated(short),
    collectionsDuringLoop: [short.trace.collectionsDuringLoop, long.trace.collectionsDuringLoop],
    counters: Object.fromEntries(counters.map(key => [key, [short[key], long[key]]]))};
}

/** Assess the fixed warm10 loop's per-iteration clause; V8 bytes are not an exact all-host-object count. */
export function assessFloatIterationCriterion(groups, positiveControl) {
  const result = {issue: 1395, criterion, measurement: '--trace-gc-nvp plus exact float-carrier counter',
    acceptance: 'unqualified', protocol: {warmupIterations: 100000, warmupSlices: 10, iterations: [100000, 1000000]},
    scope: 'These two warmed direct-CIL loops on the recorded Node/V8 engine; fixed slice entry/exit work is included.',
    allHostObjectsPerRun: 'unqualified', floatDifferential: 'requires-separate-evidence', observations: []};
  const exemplar = groups?.[0]?.control;
  if (!Array.isArray(groups) || groups.length !== 2 || groups[0]?.mode !== 'typed' || groups[1]?.mode !== 'mixed' ||
      !groups.every(group => validRow(group.control, group.mode, 0, 100000, exemplar) &&
        Array.isArray(group.samples) && group.samples.length === 2 &&
        group.samples.every((row, index) => validRow(row, group.mode, index === 0 ? 100000 : 1000000, 100000, exemplar))) ||
      !validRow(positiveControl, 'reference', 10000, 10000, exemplar) || positiveControl.floatCarriers <= 0 ||
      positiveControl.trace.reportedAllocatedBytes <= 0) {
    return {...result, reason: 'The exact matched warm10, 100k/1M protocol and detected generic allocation control are required.'};
  }
  result.observations = groups.map(observation);
  const measured = groups.flatMap(group => group.samples);
  const exactAllocation = measured.some(row => counters.some(key => row[key] > 0));
  const collected = measured.some(row => row.trace.collectionsDuringLoop > 0);
  const grows = result.observations.some(row => row.incrementalAllocatedBytes > 0);
  result.acceptance = exactAllocation ? 'missed' : collected || grows ? 'inconclusive' : 'met';
  result.reason = exactAllocation ? 'An exact counter detected allocations inside a measured loop.' : collected || grows ?
    'GC activity or increasing interval bytes prevents a zero per-iteration allocation qualification; no noise tolerance is applied.' :
    'Ten times the exact guest work adds no observed allocated bytes, with zero loop collections and exact carrier/storage counts. ' +
      'This qualifies the per-iteration trace criterion for the warmed fixtures; it does not claim zero objects for the entire run.';
  return result;
}
