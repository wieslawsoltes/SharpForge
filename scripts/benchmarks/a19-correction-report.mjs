import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const benchmark = 'project16-studio-correction-paths';
export const plan = Object.freeze({ warmups: 10, samples: 101, sourceLength: 1024, cases: Object.freeze([
  { id: 'studio.snapshot.1-source', operations: 256, sources: 1 },
  { id: 'studio.snapshot.100-source', operations: 64, sources: 100 },
  { id: 'runtime.activity.start-schedule-stop', operations: 256 },
  { id: 'editor.chord-prefix-cancel', operations: 256 }
]) });
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jsonHash = value => sha256(JSON.stringify(value));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** Fixed capture/compare CLI; sample counts cannot silently differ between checkouts. */
export function parseArguments(values) {
  const [mode, ...pairs] = values;
  const commands = { capture: ['checkout', 'output'], compare: ['baseline', 'candidate', 'output'] };
  const required = Object.hasOwn(commands, mode) ? commands[mode] : null;
  requireValue(required && pairs.length === required.length * 2,
    'Usage: capture --checkout ROOT --output JSON | compare --baseline JSON --candidate JSON --output JSON');
  const result = { mode };
  for (let index = 0; index < pairs.length; index += 2) {
    const name = pairs[index].slice(2);
    const value = pairs[index + 1];
    requireValue(pairs[index].startsWith('--') && required.includes(name) && !Object.hasOwn(result, name)
      && value && !value.startsWith('--'), `Invalid or duplicate argument: ${pairs[index]}`);
    result[name] = value;
  }
  return result;
}

/** Nearest-rank median/p95 of batch elapsed nanoseconds divided by operations per batch. */
export function summarize(samplesNs, operations) {
  requireValue(Number.isSafeInteger(operations) && operations > 0 && Array.isArray(samplesNs) && samplesNs.length > 0,
    'A summary requires samples and positive operations');
  requireValue(samplesNs.every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid nanosecond sample');
  const sorted = samplesNs.map(value => value / operations).sort((left, right) => left - right);
  return { medianNs: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ns: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

/** A failed or incomplete capture remains evidence, but can never become a comparison baseline. */
export function validateReport(report) {
  requireValue(report?.schemaVersion === 1 && report.benchmark === benchmark, 'Unknown benchmark report');
  requireValue(report.passed === true && Array.isArray(report.failures) && report.failures.length === 0, 'Capture failed');
  requireValue(isDeepStrictEqual(report.plan, plan), 'Workload plan differs');
  requireValue(/^[a-f\d]{40}$/.test(report.source?.revision ?? '') && /^[a-f\d]{40}$/.test(report.source?.tree ?? '')
    && report.source.trackedClean === true && Array.isArray(report.source.untrackedPaths), 'Missing tracked-clean source identity');
  requireValue(/^[a-f\d]{64}$/.test(report.harness?.sha256 ?? ''), 'Missing harness identity');
  for (const field of ['node', 'v8', 'platform', 'architecture', 'cpu']) {
    requireValue(typeof report.environment?.[field] === 'string' && report.environment[field].length > 0, `Missing environment ${field}`);
  }
  requireValue(Number.isSafeInteger(report.environment.logicalCpus) && report.environment.logicalCpus > 0
    && Array.isArray(report.environment.execArgv) && typeof report.environment.nodeOptions === 'string', 'Invalid environment');
  requireValue(Array.isArray(report.cases) && report.cases.length === plan.cases.length, 'Missing workload cases');
  for (const [index, specification] of plan.cases.entries()) {
    const row = report.cases[index];
    requireValue(row?.id === specification.id && row.operations === specification.operations && row.passed === true,
      `Missing or failed case: ${specification.id}`);
    requireValue(/^[a-f\d]{64}$/.test(row.fixtureSha256 ?? '') && /^[a-f\d]{64}$/.test(row.correctnessSha256 ?? ''),
      `Missing correctness identity: ${row.id}`);
    requireValue(Number.isSafeInteger(row.nativeTimeouts?.before) && row.nativeTimeouts.before >= 0
      && ['afterOperations', 'afterTurn', 'afterDispose'].every(phase => row.nativeTimeouts[phase] === row.nativeTimeouts.before),
    `Native timer cleanup was not verified: ${row.id}`);
    requireValue(Array.isArray(row.warmupBatchNs) && row.warmupBatchNs.length === plan.warmups
      && Array.isArray(row.sampleBatchNs) && row.sampleBatchNs.length === plan.samples, `Incomplete samples: ${row.id}`);
    summarize([row.firstOperationNs, ...row.warmupBatchNs], 1);
    requireValue(isDeepStrictEqual(row.summary, summarize(row.sampleBatchNs, row.operations)), `Incorrect summary: ${row.id}`);
  }
  return report;
}

/** Strict matched comparison; a >5% median OR p95 increase requires the contribution-guideline review. */
export function compareReports(baseline, candidate) {
  validateReport(baseline);
  validateReport(candidate);
  requireValue(baseline.harness.sha256 === candidate.harness.sha256, 'Harness identity differs');
  requireValue(isDeepStrictEqual(baseline.environment, candidate.environment), 'Node/OS/CPU/flags environment differs');
  const cases = baseline.cases.map((before, index) => {
    const after = candidate.cases[index];
    requireValue(before.fixtureSha256 === after.fixtureSha256 && before.correctnessSha256 === after.correctnessSha256,
      `Fixture or correctness differs: ${before.id}`);
    const metrics = Object.fromEntries(['medianNs', 'p95Ns'].map(metric => {
      const previous = before.summary[metric];
      const current = after.summary[metric];
      requireValue(previous > 0, `Zero baseline ${metric}: ${before.id}`);
      return [metric, { baseline: previous, candidate: current, changePercent: (current - previous) / previous * 100,
        reviewRequired: current * 100 > previous * 105 }];
    }));
    return { id: before.id, metrics, reviewRequired: Object.values(metrics).some(metric => metric.reviewRequired) };
  });
  return { schemaVersion: 1, benchmark, baseline: baseline.source, candidate: candidate.source,
    harnessSha256: baseline.harness.sha256, environment: baseline.environment,
    comparable: true, reviewRequired: cases.some(row => row.reviewRequired), cases };
}
