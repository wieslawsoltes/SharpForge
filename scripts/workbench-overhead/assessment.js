import {distribution} from '../editor-benchmarks/common.js';
import {operations, pairOrder, protocol, workspaceFixture} from './protocol.js';

const sum = values => values.reduce((total, value) => total + value, 0);
const overhead = (enabled, disabled) => disabled > 0 ? (enabled - disabled) / disabled * 100 : null;

function validateTrace(run) {
  const trace = run.trace;
  if (trace?.format !== 'sharpforge-workbench-trace' || trace.version !== 1 || trace.units !== 'milliseconds'
    || !Array.isArray(trace.samples) || !Array.isArray(trace.summary)) throw new Error('Missing product trace');
  if (!run.enabled) {
    if (trace.samples.length || trace.summary.length) throw new Error('Disabled tracing recorded product samples');
    return;
  }
  for (const name of ['startup', 'document-switch', 'tool-activation', 'command', 'input-delay']) {
    const samples = trace.samples.filter(sample => sample.name === name);
    const expected = name === 'input-delay' ? protocol.inputs : operations[name];
    if (samples.length < expected) throw new Error(`Incomplete product ${name} instrumentation`);
  }
  const groups = new Map();
  for (const sample of trace.samples) {
    if (!Number.isFinite(sample.duration) || sample.duration < 0) throw new Error('Invalid product duration');
    const key = JSON.stringify([sample.name, sample.sessionId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample.duration);
  }
  if (groups.size !== trace.summary.length) throw new Error('Incomplete product trace summary');
  for (const row of trace.summary) {
    const key = JSON.stringify([row.name, row.sessionId]);
    const values = groups.get(key);
    if (!values) throw new Error('Unexpected product trace summary');
    const actual = distribution(values);
    for (const [field, expected] of [['count', actual.count], ['p50', actual.p50Ms], ['p95', actual.p95Ms], ['p99', actual.p99Ms]]) {
      if (row[field] !== expected) throw new Error(`Incorrect product trace ${field}`);
    }
    groups.delete(key);
  }
}

function validateRun(run, index) {
  if (run.pair !== Math.floor(index / 2) || run.enabled !== pairOrder(run.pair)[index % 2]
    || run.order !== index % 2 || run.observedEnabled !== run.enabled) throw new Error('Invalid paired order or tracing mode');
  if (!Array.isArray(run.samples) || run.samples.length !== sum(Object.values(operations))) throw new Error('Incomplete operation samples');
  for (const [name, count] of Object.entries(operations)) {
    const samples = run.samples.filter(sample => sample.operation === name);
    if (samples.length !== count || samples.some((sample, ordinal) => sample.ordinal !== ordinal
      || !Number.isFinite(sample.durationMs) || sample.durationMs < 0)) throw new Error(`Invalid ${name} samples`);
  }
  if (!run.verified || run.verified.documentSwitches !== protocol.documentSwitches
    || run.verified.commands !== protocol.commands || run.verified.insertedCharacters !== protocol.inputs
    || run.verified.trustedInputs !== protocol.inputs || run.verified.coldTools !== protocol.tools.length) {
    throw new Error('Incomplete real application operation evidence');
  }
  validateTrace(run);
}

/** No trimming, clipping negative differences, confidence claim, or per-operation budget substitution. */
export function assessOverhead(report) {
  if (report?.format !== 'sharpforge-instrumentation-overhead' || report.version !== 1
    || report.protocol !== protocol.id || report.captureStatus !== 'completed') throw new Error('Incomplete overhead capture');
  if (!['chromium', 'firefox', 'webkit'].includes(report.environment?.engine) || !report.environment.browserVersion
    || report.environment.servingMode !== 'http-production' || report.fixture?.sha256 !== workspaceFixture().sha256
    || report.fixture.sourceFiles !== protocol.sourceFiles || report.fixture.projectFiles !== 1
    || JSON.stringify(report.workload) !== JSON.stringify(protocol)) throw new Error('Missing or changed capture provenance');
  if (!Array.isArray(report.browserErrors) || report.browserErrors.length) throw new Error('Browser errors invalidate overhead capture');
  if (!Array.isArray(report.runs) || report.runs.length !== protocol.pairs * 2) throw new Error('Incomplete alternating pairs');
  report.runs.forEach(validateRun);
  const diagnostics = Object.keys(operations).map(operation => {
    const values = enabled => report.runs.filter(run => run.enabled === enabled)
      .flatMap(run => run.samples.filter(sample => sample.operation === operation).map(sample => sample.durationMs));
    const enabled = values(true), disabled = values(false);
    return {operation, enabled: distribution(enabled), disabled: distribution(disabled),
      enabledTotalMs: sum(enabled), disabledTotalMs: sum(disabled), overheadPercent: overhead(sum(enabled), sum(disabled)),
      zeroDenominator: sum(disabled) === 0};
  });
  const pairs = Array.from({length: protocol.pairs}, (_, pair) => {
    const runs = report.runs.filter(run => run.pair === pair);
    const total = enabled => sum(runs.find(run => run.enabled === enabled).samples.map(sample => sample.durationMs));
    const enabledMs = total(true), disabledMs = total(false);
    if (disabledMs <= 0) throw new Error('Unmeasurable disabled workload');
    return {pair, enabledMs, disabledMs, deltaMs: enabledMs - disabledMs, overheadPercent: overhead(enabledMs, disabledMs)};
  });
  const enabledMs = sum(pairs.map(pair => pair.enabledMs)), disabledMs = sum(pairs.map(pair => pair.disabledMs));
  const overheadPercent = overhead(enabledMs, disabledMs);
  return {passed: overheadPercent < protocol.budgetPercent, budgetPercent: protocol.budgetPercent, overheadPercent,
    enabledMs, disabledMs, deltaMs: enabledMs - disabledMs, pairs, diagnostics,
    gate: 'ratio of paired sums of the identical measured workload; strictly less than 1%',
    interpretation: 'One bounded shared-host observation; not statistical proof. All raw samples retained.'};
}
