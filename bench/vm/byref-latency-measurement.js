import {measureCompleteWorkload, workloadLatencyVmOptions} from './complete-workload-latency.js';
import {byrefLatencyFixture as fixture} from './byref-latency-fixture.js';

export const byrefLatencyVmOptions = workloadLatencyVmOptions;

/** Keep the existing byref protocol while sharing the complete cold/warm execution boundaries. */
export function measureByrefLatency(engine, artifact, options, signal, onProgress) {
  if (!['source', 'reloaded', 'cil'].includes(engine)) return Promise.reject(new TypeError('Unknown byref latency engine'));
  return measureCompleteWorkload({fixture, rowPrefix: 'byref-latency', minimumCollections: 4},
    engine, artifact, options, {signal, onProgress});
}
