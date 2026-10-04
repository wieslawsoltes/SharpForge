import {microbenchmarks, startupApps, snapshotCase} from './fixtures.js';
import {hash, stable} from './evidence.js';
import {requireSamples, distribution} from './statistics.js';
import {metricPlan} from './metric-contracts.js';

function expectedRows(protocol) {
  const groups = {micro: microbenchmarks, startup: startupApps, snapshot: [snapshotCase]};
  const rows = new Map();
  for (const [kind, fixtures] of Object.entries(groups)) {
    if (protocol.suite !== 'all' && protocol.suite !== kind) continue;
    for (const fixture of fixtures) for (const engine of protocol.engines) {
      rows.set(`${kind}/${fixture.id}/${engine}`, {kind, engine, fixture: fixture.id, reason: fixture.unsupported?.[engine]});
    }
  }
  return rows;
}

function validateProvenance(report, options) {
  if (!report || report.schemaVersion !== 2 || report.suite !== 'SF-A05-T12' ||
      !['measured', 'qualified'].includes(report.status) || options.baseline && report.status !== 'qualified') {
    throw new TypeError('Performance reports must be measured; the baseline must be qualified by two complete runs');
  }
  if (report.syntheticUnitTestData && options.allowSynthetic !== true) {
    throw new TypeError('Synthetic unit-test observations cannot qualify a performance baseline');
  }
  if (report.measurementKind !== 'runtime-benchmark' || report.nativeQualification !== false ||
      !Array.isArray(report.command) || !report.command.length || report.command.some(part => typeof part !== 'string' || !part)) {
    throw new TypeError('Missing actual measurement kind or command provenance');
  }
  if (report.worktreeStatus !== '' || report.completedWorktreeStatus !== '' || report.completedCommit !== report.commit ||
      !/^[a-f0-9]{40,64}$/.test(report.commit ?? '') || !/^[a-f0-9]{64}$/.test(report.harnessHash ?? '') ||
      !Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new TypeError('Incomplete, dirty or changed measurement revision');
  }
  if (!Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt)) ||
      Date.parse(report.startedAt) > Date.parse(report.completedAt)) throw new TypeError('Invalid measurement interval');
  const environment = report.environment;
  if (!environment?.node || !environment.v8 || !environment.platform || !environment.arch || !environment.os ||
      !environment.executable || !/^[a-f0-9]{64}$/.test(environment.host ?? '') ||
      !Array.isArray(environment.cpuModels) || !environment.cpuModels.length ||
      environment.cpuModels.some(model => typeof model !== 'string' || !model) ||
      !Number.isInteger(environment.logicalCpus) || environment.logicalCpus < 1 ||
      !Number.isSafeInteger(environment.memoryBytes) || environment.memoryBytes <= 0 || !Array.isArray(environment.execArgv) ||
      typeof environment.gcExposed !== 'boolean' || !environment.versions || !environment.locale) {
    throw new TypeError('Incomplete runner metadata');
  }
  if (!/^[\w.-]{1,80}$/.test(environment.runner ?? '') || report.environmentFingerprint !== hash(stable(environment))) {
    throw new TypeError('Malformed runner fingerprint');
  }
}

function validateProtocol(protocol) {
  if (protocol?.version !== 2 || !Number.isInteger(protocol.samples) || protocol.samples < 20 || protocol.samples > 10000 ||
      !Number.isInteger(protocol.warmup) || protocol.warmup < 1 || protocol.warmup > 1000 ||
      protocol.scheduling?.workers !== 1 || protocol.scheduling.sliceInstructions !== 10000 || protocol.scheduling.sliceMs !== 8 ||
      protocol.scheduling.yield !== 'setImmediate-between-nonterminal-slices' ||
      !['all', 'micro', 'startup', 'snapshot'].includes(protocol.suite) ||
      !Array.isArray(protocol.engines) || !protocol.engines.length || new Set(protocol.engines).size !== protocol.engines.length ||
      protocol.engines.some(engine => !['source', 'reloaded', 'cil'].includes(engine))) {
    throw new TypeError('Invalid measurement protocol');
  }
  const configuration = protocol.vmOptions;
  if (![32, 64].includes(configuration?.nativeIntBits) || configuration.maxInstructions !== 20000000 ||
      ['sourceFusion', 'specializeNumericHandlers', 'typedNumericStack', 'smallLongs'].some(key => typeof configuration[key] !== 'boolean') ||
      configuration.wasmTiering !== false || Object.hasOwn(configuration, 'smallLongFastPath')) {
    throw new TypeError('Invalid interpreter or numeric configuration');
  }
  if (typeof protocol.portableSnapshots !== 'boolean' || !protocol.preparation ||
      stable(Object.keys(protocol.preparation).sort()) !== stable(['cil', 'reloaded', 'source'])) {
    throw new TypeError('Missing phase capabilities');
  }
  for (const [engine, phase] of Object.entries(protocol.preparation)) {
    if (phase.status === 'available') {
      if (Object.keys(phase).length !== 1) throw new TypeError('Malformed available preparation phase');
    } else if (engine === 'cil' || !['unsupported', 'not-required'].includes(phase.status) ||
        typeof phase.reason !== 'string' || !phase.reason) throw new TypeError('Malformed unavailable preparation phase');
  }
  if (stable(protocol.preparation.source) !== stable(protocol.preparation.reloaded)) {
    throw new TypeError('Source preparation capabilities differ between equivalent engines');
  }
  if (protocol.fixtureHash !== hash(stable({microbenchmarks, startupApps, snapshotCase}))) {
    throw new TypeError('Fixture catalog mismatch');
  }
}

function validateMemory(value) {
  const keys = ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'];
  if (!value || keys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
    throw new TypeError('Malformed host memory gauges');
  }
}

function validateSamples(row, protocol) {
  const expectedCount = protocol.samples + (row.kind === 'startup' ? 0 : protocol.warmup + 1);
  if (!Array.isArray(row.samples) || row.samples.length !== expectedCount) throw new TypeError('Missing raw observations: ' + row.id);
  for (let index = 0; index < row.samples.length; index++) {
    const sample = row.samples[index];
    const phase = row.kind === 'startup' ? 'measured' : index === 0 ? 'first' : index <= protocol.warmup ? 'warmup' : 'measured';
    if (sample.index !== index || sample.phase !== phase || sample.outputVerified !== true) {
      throw new TypeError('Unverified, duplicated or reordered raw observation: ' + row.id);
    }
    validateMemory(sample.hostBefore);
    validateMemory(sample.hostAfter);
    for (const key of Object.keys(row.unavailableMetrics)) {
      if (Object.hasOwn(sample, key)) throw new TypeError('Unavailable phase has a fabricated duration: ' + key);
    }
    if (row.kind === 'micro') {
      const throughput = sample.instructions * 1000 / sample.executionMs;
      if (!Number.isSafeInteger(sample.instructions) || sample.instructions < 1 ||
          Math.abs(sample.instructionsPerSecond - throughput) > Number.EPSILON * 8 * throughput) {
        throw new TypeError('Throughput differs from actual instruction counter and interval');
      }
    }
    if (row.kind === 'startup') {
      const available = protocol.preparation[row.engine].status === 'available';
      if (sample.preparation?.status !== (available ? 'prepared' : protocol.preparation[row.engine].status) ||
          !Number.isSafeInteger(sample.preparation.methods) || sample.preparation.methods < 0 ||
          sample.preparation.engine !== (row.engine === 'cil' ? 'cil' : 'source') ||
          !available && (sample.preparation.methods !== 0 || sample.preparation.reason !== protocol.preparation[row.engine].reason) ||
          !Number.isFinite(sample.preparationCallMs) || sample.preparationCallMs < 0 ||
          available && sample.predecodeMs !== sample.preparationCallMs) {
        throw new TypeError('Invalid startup preparation evidence');
      }
      if (!Number.isFinite(sample.executionMs) || sample.executionMs <= 0 ||
          sample.firstOutputExecutionMs > sample.executionMs || sample.timeToFirstOutputMs < sample.firstOutputExecutionMs ||
          sample.processFirstOutputMs < sample.timeToFirstOutputMs || sample.childProcessMs < sample.processFirstOutputMs) {
        throw new TypeError('Inconsistent cold-start timing boundaries');
      }
    }
    if (row.kind === 'snapshot' && protocol.portableSnapshots &&
        (sample.portableOutputVerified !== true || !Number.isSafeInteger(sample.wireBytes) || sample.wireBytes < 1)) {
      throw new TypeError('Portable snapshot was not copied and replay-verified');
    }
  }
  const measured = row.samples.filter(sample => sample.phase === 'measured');
  for (const [key, metric] of Object.entries(row.metrics)) {
    requireSamples(row.samples.map(sample => sample[key]));
    if (metric.unit === 'objects' || metric.unit === 'bytes') {
      if (row.samples.some(sample => !Number.isSafeInteger(sample[key]))) throw new TypeError('Fractional managed allocation counter');
    } else if (row.samples.some(sample => sample[key] <= 0)) throw new TypeError('Unmeasured latency or throughput');
    if (stable(row.summary?.[key]) !== stable(distribution(measured.map(sample => sample[key])))) {
      throw new TypeError('Summary differs from retained raw observations: ' + key);
    }
  }
  if (stable(Object.keys(row.summary ?? {}).sort()) !== stable(Object.keys(row.metrics).sort())) {
    throw new TypeError('Unknown summary metric');
  }
}

export function validateReport(report, options = {}) {
  validateProvenance(report, options);
  validateProtocol(report.protocol);
  const expected = expectedRows(report.protocol);
  const rows = new Map();
  if (!Array.isArray(report.rows)) throw new TypeError('Missing benchmark cases');
  for (const row of report.rows) {
    const definition = expected.get(row.id);
    if (!definition || rows.has(row.id) || row.kind !== definition.kind || row.engine !== definition.engine ||
        row.fixture !== definition.fixture) throw new TypeError('Unknown or duplicate benchmark case: ' + row.id);
    rows.set(row.id, row);
    if (!Number.isFinite(row.compilationMs) || row.compilationMs < 0 || !/^[a-f0-9]{64}$/.test(row.assemblyHash ?? '')) {
      throw new TypeError('Missing compiled artifact provenance: ' + row.id);
    }
    if (definition.reason) {
      if (row.status !== 'unsupported' || row.reason !== definition.reason || row.samples?.length !== 0 ||
          stable(row.metrics) !== '{}' || stable(row.unavailableMetrics) !== '{}') {
        throw new TypeError('Unsupported case was presented as measured: ' + row.id);
      }
      continue;
    }
    const plan = metricPlan(row.kind, row.engine, report.protocol);
    if (row.status !== 'measured' || stable(row.metrics) !== stable(plan.metrics) ||
        stable(row.unavailableMetrics) !== stable(plan.unavailableMetrics)) {
      throw new TypeError('Missing or incorrectly labeled metric phases: ' + row.id);
    }
    validateSamples(row, report.protocol);
  }
  if (rows.size !== expected.size) throw new TypeError('Incomplete benchmark case set');
  if (options.baseline && (!report.qualification || report.qualification.status !== 'stable' || !report.qualification.repeat)) {
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
