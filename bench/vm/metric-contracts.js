import {measuredMetric} from './evidence.js';

const latency = keys => Object.fromEntries(keys.map(key => [key, measuredMetric('ms')]));
const allocations = () => ({
  managedAllocations: measuredMetric('objects', ['median']),
  managedAllocatedBytes: measuredMetric('bytes', ['median']),
});
const portableMetrics = ['exportMs', 'structuredCopyMs', 'importRestoreMs'];
export const portableUnavailableReason = 'Portable snapshot export/restore APIs are unavailable in this runtime revision';

/** Schema-owned metric selection prevents unsupported phases from masquerading as zero-duration samples. */
export function metricPlan(kind, engine, protocol) {
  const unavailableMetrics = {};
  let metrics;
  if (kind === 'micro') {
    metrics = {...latency(['executionMs']),
      instructionsPerSecond: measuredMetric('instructions/s', ['median'], 'lower'), ...allocations()};
  } else if (kind === 'startup') {
    metrics = {...latency(['loadMs', 'verificationMs', 'constructionMs', 'firstOutputExecutionMs',
      'timeToFirstOutputMs', 'processFirstOutputMs', 'childProcessMs']), ...allocations()};
    const preparation = protocol.preparation[engine];
    if (preparation.status === 'available') metrics.predecodeMs = measuredMetric('ms');
    else unavailableMetrics.predecodeMs = {...preparation};
  } else if (kind === 'snapshot') {
    metrics = latency(['captureMs', 'restoreMs', 'freshConstructionMs', 'replayMs']);
    for (const key of portableMetrics) {
      if (protocol.portableSnapshots) metrics[key] = measuredMetric('ms');
      else unavailableMetrics[key] = {status: 'unsupported', reason: portableUnavailableReason};
    }
  } else throw new TypeError('Unknown benchmark kind: ' + kind);
  return {metrics, unavailableMetrics};
}
