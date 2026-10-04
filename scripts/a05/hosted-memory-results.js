import {isDeepStrictEqual} from 'node:util';
import {assessFloatIterationCriterion} from '../../bench/vm/float-allocation-criterion.js';
import {assessSnapshotRetention} from '../../bench/vm/snapshot-retention-census.js';

/** Recompute existing memory criteria from complete raw rows, never from a copied acceptance label. */
export function hostedMemoryResult(kind, report) {
  try {
    if (kind === 'float') {
      if (report.format !== 'SharpForge.FloatAllocation/1' || report.protocol?.iterations !== 1000000 ||
          report.protocol.warmup !== 100000 || report.protocol.warmupSlices !== 10 || report.acceptance !== 'partial') return false;
      const actual = assessFloatIterationCriterion(report.rows, report.positiveAllocationControl);
      const traces = [...report.rows.flatMap(group => [group.control, ...group.samples]), report.positiveAllocationControl];
      return actual.acceptance === 'met' && isDeepStrictEqual(actual, report.perIterationAllocationCriterion) && traces.length === 7 &&
        traces.every(row => typeof row.tracePath === 'string' && /^[a-f0-9]{64}$/.test(row.traceSHA256));
    }
    const row = report.rows?.[0];
    return kind === 'snapshot' && report.format === 'SharpForge.SnapshotRetention/1' &&
      report.protocol?.snapshots === 128 && report.protocol.scenario === 'original-records' && report.protocol.maxRetainedMiB === 256 &&
      report.rows.length === 1 && row.scenario === 'original-records' && row.snapshotsRequested === 128 && row.snapshotsCaptured === 128 &&
      row.restoreEquivalence?.equal === true && row.restoreEquivalence.revisions === 128 && row.hostCapBytes === 256 * 1024 ** 2 &&
      row.fixture?.mutationUnit === 'record' && row.fixture.managedLiveBytes >= 10000000 &&
      typeof row.tracePath === 'string' && /^[a-f0-9]{64}$/.test(row.traceSHA256) &&
      assessSnapshotRetention(row).status === 'met-for-this-workload' && isDeepStrictEqual(assessSnapshotRetention(row), row.assessment);
  } catch {
    // Incomplete driver output is a failed qualification, never a substitute synthetic row.
    return false;
  }
}
