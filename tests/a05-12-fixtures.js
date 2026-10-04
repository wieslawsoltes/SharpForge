// Synthetic unit-test reports only. Never used as a measured performance baseline.
import {hash, stable, measuredMetric, finalizeRow} from '../bench/vm/evidence.js';
import {microbenchmarks, startupApps, snapshotCase} from '../bench/vm/fixtures.js';

export function reportFixture({day = 1, factor = 1} = {}) {
  const environment = {runner: 'unit-test-only', node: 'unit-node', v8: 'unit-v8', platform: 'test', arch: 'test',
    os: 'unit-os', cpuModels: ['unit-cpu'], logicalCpus: 1, memoryBytes: 512, execArgv: [], gcExposed: false,
    versions: {node: 'unit-node'}, locale: {}};
  const report = {schemaVersion: 1, suite: 'SF-A05-T12', status: 'measured', syntheticUnitTestData: true,
    commit: 'a'.repeat(40), harnessHash: hash('unit-harness'), worktreeStatus: '', errors: [],
    startedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: `2026-01-${String(day).padStart(2, '0')}T00:01:00.000Z`,
    environment, environmentFingerprint: hash(stable(environment)), protocol: {
      version: 1, samples: 20, warmup: 1, suite: 'micro', engines: ['cil'], scheduling: {workers: 1},
      fixtureHash: hash(stable({microbenchmarks, startupApps, snapshotCase})),
    }, rows: []};
  for (const fixture of microbenchmarks) {
    const row = {id: `micro/${fixture.id}/cil`, kind: 'micro', engine: 'cil', status: 'measured', samples: [], metrics: {
      executionMs: measuredMetric('ms'), instructionsPerSecond: measuredMetric('instructions/s', ['median'], 'lower'),
      managedAllocations: measuredMetric('objects', ['median']), managedAllocatedBytes: measuredMetric('bytes', ['median']),
    }};
    for (let index = 0; index < 22; index++) {
      const executionMs = (10 + index % 3 / 10) * factor;
      row.samples.push({index, phase: index === 0 ? 'first' : index === 1 ? 'warmup' : 'measured', executionMs,
        instructionsPerSecond: 100000 / executionMs, managedAllocations: 1, managedAllocatedBytes: 32, outputVerified: true});
    }
    report.rows.push(finalizeRow(row));
  }
  return report;
}
