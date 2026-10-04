// Explicit synthetic unit-test reports. Production qualification rejects these observations.
import {hash, stable, finalizeRow} from '../bench/vm/evidence.js';
import {microbenchmarks, startupApps, snapshotCase} from '../bench/vm/fixtures.js';
import {metricPlan} from '../bench/vm/metric-contracts.js';

const memory = () => ({rss: 1000, heapUsed: 100, heapTotal: 500, external: 0, arrayBuffers: 0});
export const syntheticOptions = Object.freeze({allowSynthetic: true, resamples: 1000});

function sampleFor(row, index, options, protocol) {
  const {factor} = options;
  const executionMs = (10 + index % 3 / 10) * factor;
  const sample = {index, phase: row.kind === 'startup' ? 'measured' : index === 0 ? 'first' : index === 1 ? 'warmup' : 'measured',
    executionMs, instructions: 1000, instructionsPerSecond: 1000000 / executionMs,
    managedAllocations: 1, managedAllocatedBytes: 32, hostBefore: memory(), hostAfter: memory(), outputVerified: true};
  if (row.kind === 'startup') {
    Object.assign(sample, {loadMs: factor, verificationMs: 2 * factor, constructionMs: 3 * factor,
      firstOutputExecutionMs: 8 * factor, timeToFirstOutputMs: 20 * factor, processFirstOutputMs: 50 * factor,
      childProcessMs: 60 * factor, preparationCallMs: factor,
      preparation: {engine: row.engine === 'cil' ? 'cil' : 'source',
        ...(protocol.preparation[row.engine].status === 'available' ? {status: 'prepared', methods: 1} :
          {status: 'not-required', methods: 0, reason: protocol.preparation[row.engine].reason})}});
    if (protocol.preparation[row.engine].status === 'available') sample.predecodeMs = factor;
  }
  if (row.kind === 'snapshot') {
    for (const key of Object.keys(row.metrics)) sample[key] = factor;
    if (protocol.portableSnapshots) Object.assign(sample, {wireBytes: 256, portableOutputVerified: true});
  }
  return sample;
}

export function reportFixture({day = 1, factor = 1, suite = 'micro', engine = 'cil', portableSnapshots = true,
  sourcePreparation = {status: 'available'}} = {}) {
  const environment = {runner: 'unit-test-only', host: hash('unit-host'), node: 'unit-node', v8: 'unit-v8', platform: 'test', arch: 'test',
    os: 'unit-os', executable: '/unit-node', cpuModels: ['unit-cpu'], logicalCpus: 1, memoryBytes: 512,
    execArgv: [], gcExposed: false, versions: {node: 'unit-node'}, locale: {}};
  Object.assign(environment, {nodeOptions: null, heapSizeLimit: 512 * 1024 * 1024,
    resourceControls: {SHARPFORGE_TEST_CONCURRENCY: '1', SHARPFORGE_MAX_PARALLEL_RUNS: '1', SHARPFORGE_MAX_OLD_SPACE_MB: '512'}});
  const report = {schemaVersion: 2, suite: 'SF-A05-T12', status: 'measured', syntheticUnitTestData: true,
    measurementKind: 'runtime-benchmark', nativeQualification: false, command: ['node', 'unit-fixture-only'],
    commit: 'a'.repeat(40), completedCommit: 'a'.repeat(40), harnessHash: hash('unit-harness'),
    worktreeStatus: '', completedWorktreeStatus: '', errors: [],
    startedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: `2026-01-${String(day).padStart(2, '0')}T00:01:00.000Z`,
    environment, environmentFingerprint: hash(stable(environment)), protocol: {
      version: 2, samples: 20, warmup: 1, suite, engines: [engine],
      scheduling: {workers: 1, sliceInstructions: 10000, sliceMs: 8, yield: 'setImmediate-between-nonterminal-slices'},
      fixtureHash: hash(stable({microbenchmarks, startupApps, snapshotCase})),
      vmOptions: {nativeIntBits: 32, maxInstructions: 20000000, sourceFusion: true, specializeNumericHandlers: true,
        typedNumericStack: false, smallLongs: true, wasmTiering: false},
      portableSnapshots, preparation: {source: sourcePreparation, reloaded: sourcePreparation, cil: {status: 'available'}},
    }, rows: []};
  const groups = {micro: microbenchmarks, startup: startupApps, snapshot: [snapshotCase]};
  for (const [kind, fixtures] of Object.entries(groups)) {
    if (suite !== 'all' && kind !== suite) continue;
    for (const fixture of fixtures) {
      const row = {id: `${kind}/${fixture.id}/${engine}`, kind, engine, fixture: fixture.id, samples: [],
        compilationMs: 1, assemblyHash: hash(fixture.id), ...metricPlan(kind, engine, report.protocol)};
      if (fixture.dispatchByEngine) row.dispatch = fixture.dispatchByEngine[engine];
      if (fixture.unsupported?.[engine]) {
        Object.assign(row, {status: 'unsupported', reason: fixture.unsupported[engine], metrics: {}, unavailableMetrics: {}});
      } else {
        const count = kind === 'startup' ? 20 : 22;
        for (let index = 0; index < count; index++) row.samples.push(sampleFor(row, index, {factor}, report.protocol));
        finalizeRow(row);
      }
      report.rows.push(row);
    }
  }
  return report;
}
