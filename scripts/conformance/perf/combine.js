import {benchmark} from './core.js';
import {allocationSummary} from './alloc.js';

/** Summarize all independent samples, never a single process's stability verdict. */
export function combineMeasurements(selected) {
  const first = selected[0];
  if (!first) throw new Error('No benchmark measurements to combine');
  if (selected.some(row => row.id !== first.id || row.engine !== first.engine || row.area !== first.area)) {
    throw new Error('Cannot combine different benchmark identities');
  }
  if (selected.some(row => row.correctness.checksum !== first.correctness.checksum)) {
    throw new Error('Nondeterministic correctness ' + first.id);
  }
  const metrics = selected.flatMap(row => {
    const values = row.metrics?.samples;
    if (values == null) return row.samples.map(() => null);
    if (!Array.isArray(values) || values.length !== row.samples.length) throw new Error('Metric sample count differs from timing samples');
    return values;
  });
  return benchmark({...first,
    samples: selected.flatMap(row => row.samples),
    coldSamples: selected.flatMap(row => row.coldSamples),
    checksum: first.correctness.checksum,
    metrics: {samples: metrics, allocationSummary: allocationSummary(metrics)}
  });
}
