import {microbenchmarks, startupApps, snapshotCase} from './fixtures.js';
import {hash, stable} from './evidence.js';
import {requireSamples} from './statistics.js';

const requiredMetrics = Object.freeze({
  micro: ['executionMs', 'instructionsPerSecond', 'managedAllocations', 'managedAllocatedBytes'],
  startup: ['loadMs', 'verificationMs', 'constructionMs', 'predecodeMs', 'firstOutputExecutionMs',
    'timeToFirstOutputMs', 'processFirstOutputMs', 'childProcessMs', 'managedAllocations', 'managedAllocatedBytes'],
  snapshot: ['captureMs', 'restoreMs', 'exportMs', 'structuredCopyMs', 'importRestoreMs', 'freshConstructionMs'],
});

function expectedRows(protocol) {
  const groups = {micro: microbenchmarks, startup: startupApps, snapshot: [snapshotCase]};
  const rows = new Map();
  for (const [kind, fixtures] of Object.entries(groups)) {
    if (protocol.suite !== 'all' && protocol.suite !== kind) continue;
    for (const fixture of fixtures) for (const engine of protocol.engines) {
      rows.set(`${kind}/${fixture.id}/${engine}`, {kind, engine, reason: fixture.unsupported?.[engine]});
    }
  }
  return rows;
}

export function validateReport(report, {baseline = false} = {}) {
  if (!report || report.schemaVersion !== 1 || report.suite !== 'SF-A05-T12' ||
      !['measured', 'qualified'].includes(report.status) || baseline && report.status !== 'qualified') {
    throw new TypeError('Performance reports must be measured; the baseline must be qualified by two complete runs');
  }
  if (report.worktreeStatus !== '' || !/^[a-f0-9]{40,64}$/.test(report.commit ?? '') ||
      !/^[a-f0-9]{64}$/.test(report.harnessHash ?? '') || !report.completedAt || report.errors?.length !== 0) {
    throw new TypeError('Incomplete, dirty or malformed measurement provenance');
  }
  const environment = report.environment;
  if (!Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt)) ||
      Date.parse(report.startedAt) > Date.parse(report.completedAt)) throw new TypeError('Invalid measurement interval');
  if (!environment?.node || !environment.v8 || !environment.platform || !environment.arch || !environment.os ||
      !Array.isArray(environment.cpuModels) || !environment.cpuModels.length || !Number.isInteger(environment.logicalCpus) ||
      environment.logicalCpus < 1 || !(environment.memoryBytes > 0) || !Array.isArray(environment.execArgv) ||
      typeof environment.gcExposed !== 'boolean' || !environment.versions || !environment.locale) {
    throw new TypeError('Incomplete runner metadata');
  }
  if (!environment.runner || report.environmentFingerprint !== hash(stable(environment))) {
    throw new TypeError('Malformed runner fingerprint');
  }
  const protocol = report.protocol;
  if (protocol?.version !== 1 || !Number.isInteger(protocol.samples) || protocol.samples < 20 ||
      !Number.isInteger(protocol.warmup) || protocol.warmup < 1 || protocol.scheduling?.workers !== 1 ||
      !['all', 'micro', 'startup', 'snapshot'].includes(protocol.suite) ||
      !Array.isArray(protocol.engines) || !protocol.engines.length || new Set(protocol.engines).size !== protocol.engines.length ||
      protocol.engines.some(engine => !['source', 'reloaded', 'cil'].includes(engine))) throw new TypeError('Invalid measurement protocol');
  if (protocol.fixtureHash !== hash(stable({microbenchmarks, startupApps, snapshotCase}))) throw new TypeError('Fixture catalog mismatch');
  const expected = expectedRows(protocol), rows = new Map();
  if (!Array.isArray(report.rows)) throw new TypeError('Missing benchmark cases');
  for (const row of report.rows) {
    const definition = expected.get(row.id);
    if (!definition || rows.has(row.id) || row.kind !== definition.kind || row.engine !== definition.engine) {
      throw new TypeError('Unknown or duplicate benchmark case: ' + row.id);
    }
    rows.set(row.id, row);
    if (definition.reason) {
      if (row.status !== 'unsupported' || row.reason !== definition.reason || row.samples?.length !== 0 ||
          Object.keys(row.metrics ?? {}).length !== 0) throw new TypeError('Unsupported case was presented as measured: ' + row.id);
      continue;
    }
    const keys = Object.keys(row.metrics ?? {}).sort();
    if (row.status !== 'measured' || stable(keys) !== stable([...requiredMetrics[row.kind]].sort())) {
      throw new TypeError('Missing measurements or metrics: ' + row.id);
    }
    if (!Array.isArray(row.samples) || row.samples.some(sample => sample.outputVerified !== true ||
        !['first', 'warmup', 'measured'].includes(sample.phase))) throw new TypeError('Unverified/malformed raw samples: ' + row.id);
    const measured = row.samples.filter(sample => sample.phase === 'measured');
    const total = protocol.samples + (row.kind === 'startup' ? 0 : protocol.warmup + 1);
    if (measured.length !== protocol.samples || row.samples.length !== total) throw new TypeError('Missing raw observations: ' + row.id);
    for (const key of keys) {
      const metric = row.metrics[key];
      if (!['ms', 'bytes', 'objects', 'instructions/s'].includes(metric.unit) ||
          !['higher', 'lower'].includes(metric.direction) || !Array.isArray(metric.statistics) || !metric.statistics.length ||
          new Set(metric.statistics).size !== metric.statistics.length ||
          metric.statistics.some(statistic => !['median', 'p95', 'p99'].includes(statistic))) throw new TypeError('Malformed metric: ' + key);
      const expectedUnit = key.endsWith('Ms') ? 'ms' : key === 'instructionsPerSecond' ? 'instructions/s'
        : key === 'managedAllocatedBytes' ? 'bytes' : 'objects';
      const expectedStatistics = key.endsWith('Ms') ? ['median', 'p95', 'p99'] : ['median'];
      if (metric.unit !== expectedUnit || metric.direction !== (key === 'instructionsPerSecond' ? 'lower' : 'higher') ||
          stable(metric.statistics) !== stable(expectedStatistics)) throw new TypeError('Metric contract differs: ' + key);
      requireSamples(row.samples.map(sample => sample[key]));
      if (metric.direction === 'lower' && row.samples.some(sample => sample[key] <= 0)) throw new TypeError('Unmeasured throughput');
    }
  }
  if (rows.size !== expected.size) throw new TypeError('Incomplete benchmark case set');
  if (baseline && (!report.qualification || report.qualification.status !== 'stable' || !report.qualification.repeat)) {
    throw new TypeError('Baseline lacks repeat-run stability evidence');
  }
  return rows;
}

export function compatibleReports(baseline, candidate) {
  for (const field of ['environmentFingerprint', 'harnessHash']) {
    if (baseline[field] !== candidate[field]) throw new TypeError('Incompatible ' + field);
  }
  if (stable(baseline.protocol) !== stable(candidate.protocol)) throw new TypeError('Incompatible measurement options/protocol');
  if (stable(baseline.environment) !== stable(candidate.environment)) throw new TypeError('Runner fingerprint payload differs');
}
