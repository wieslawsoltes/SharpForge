import {selectQualificationTargets} from './qualification-fixtures.js';
import {numericDifferential} from './numeric-differential.js';
import {measureExecutionPair, qualificationVmOptions} from './qualification-execution.js';
import {measureRootQualification} from './root-qualification.js';
import {measureArrayFairness} from './array-fairness.js';
import {measureTieredFairness} from './tiered-fairness.js';
import {loadProfilerReference} from './profiler-reference.js';
import {selectProfilerDefinitions, requiredProfilerRows, profilerCoverage} from './qualification-profiler.js';
import {abortIfNeeded} from './operations.js';
import {parseQualificationOptions, requireQualificationOptions} from './qualification-options.js';
import {createReport, completeReport, writeReport, recordError, isMain} from './evidence.js';

const includes = (options, suite) => options.suite === 'all' || options.suite === suite;

/** Target completion is separate from successful execution and from the T12 regression gate. */
export function qualificationAcceptance(rows, requiredRowIds = []) {
  const decisions = rows.filter(row => row.required !== false).map(row => row.target?.acceptance ?? 'unavailable');
  if (decisions.some(value => ['failed', 'missed'].includes(value))) return 'missed';
  const measured = new Set(rows.filter(row => row.status === 'measured' && row.required !== false).map(row => row.id));
  if (requiredRowIds.some(id => !measured.has(id))) return 'incomplete';
  if (!decisions.length || decisions.some(value => ['partial', 'unavailable'].includes(value))) return 'incomplete';
  if (decisions.includes('inconclusive')) return 'inconclusive';
  return decisions.every(value => value === 'met') ? 'met' : 'incomplete';
}

export async function recordMeasurement(context, id, measure, required) {
  abortIfNeeded(context.signal);
  let row;
  try {
    row = await measure();
    if (row.status === 'failed' || row.status === 'cancelled') context.report.errors.push({id, ...row.error});
  } catch (error) {
    row = error.evidence ?? {id, status: context.signal.aborted ? 'cancelled' : 'failed'};
    row.error = recordError(error);
    row.target ??= {acceptance: 'failed'};
    context.report.errors.push({id, ...row.error});
  }
  if (required !== undefined) row.required = required;
  context.report.rows.push(row);
  writeReport(context.report, context.options.out);
  process.stdout.write(`${row.status}: ${id}${row.target ? ' / ' + row.target.acceptance : ''}\n`);
  abortIfNeeded(context.signal);
}

async function runDifferentials(context) {
  for (const width of [32, 64]) {
    if (context.options.width !== 'all' && context.options.width !== String(width)) continue;
    await recordMeasurement(context, 'numeric-' + width, async () => {
      const row = await numericDifferential(width, context.options, context.signal);
      return {...row, id: 'numeric-' + width, issue: width === 32 ? 1396 : 1397,
        target: {kind: 'minimum-differential-count', value: row.requiredForAcceptance, observed: row.completed,
          acceptance: row.status === 'passed' ? 'met' : row.status === 'partial' ? 'partial' : 'failed'}};
    });
  }
}

async function runProfiler(context) {
  const mode = context.options.profilerMode ?? 'both';
  if (mode !== 'on' && !context.options.profilerReference) {
    context.report.rows.push({id: 'profiler-off', issue: 1402, status: 'unavailable', target: {acceptance: 'unavailable'},
      reason: 'A validated profiler-hook-free reference manifest is required. profile:false and an omitted option share the same hooks.'});
    return;
  }
  const reference = mode === 'on' ? null : await loadProfilerReference(context.options.profilerReference);
  if (reference) context.report.profilerReference = reference.manifest;
  for (const definition of selectProfilerDefinitions(mode, reference?.api)) {
    await recordMeasurement(context, definition.id,
      () => measureExecutionPair(definition, context.options, context.signal), definition.required);
  }
}

async function runSuites(context) {
  const {options, signal} = context;
  if (includes(options, 'differential')) await runDifferentials(context);
  if (includes(options, 'targets')) {
    for (const definition of selectQualificationTargets(options.target ?? null)) {
      await recordMeasurement(context, definition.id, () => measureExecutionPair(definition, options, signal));
    }
  }
  for (const engine of ['source', 'cil']) {
    if (includes(options, 'roots')) {
      await recordMeasurement(context, 'root-visitor-' + engine, () => measureRootQualification(engine, options, signal));
    }
    if (includes(options, 'fairness')) {
      await recordMeasurement(context, 'array-sort-fairness-' + engine, () => measureArrayFairness(engine, options, signal));
    }
  }
  if (includes(options, 'fairness')) {
    await recordMeasurement(context, 'tiered-loop-fairness-cil', () => measureTieredFairness(options, signal));
  }
  if (includes(options, 'profiler')) await runProfiler(context);
}

export async function runQualification(options, externalSignal) {
  requireQualificationOptions(options);
  const protocol = {version: 1, suite: options.suite, target: options.target ?? null, width: options.width, samples: options.samples, warmup: options.warmup,
    profilerMode: options.profilerMode ?? 'both',
    int32Cases: options.int32Cases, int64Cases: options.int64Cases, seed: options.seed, resamples: options.resamples,
    timeoutSeconds: options.timeoutSeconds, rootScans: options.rootScans, arrayElements: options.arrayElements,
    vmOptions: qualificationVmOptions(options),
    pairing: 'Alternating order, one persistent prepared VM per mode; cold construction/preparation reported separately.',
    warmPolicy: 'First execution plus configured warmup pairs are retained and excluded from measured summaries.',
    gc: 'Exposed host GC before each complete warm observation; managed GC stays inside guest execution. ' +
      'Explicit pool/root correctness collections and array verification are outside their respective timers.',
    memory: 'Managed and frame allocation counters are exact; process host-memory fields are gauges, never allocation totals.',
    scope: 'Same-host JavaScript VM qualification. Reduced differential counts or array sizes remain explicitly partial.'};
  const report = createReport(protocol, options.runner);
  report.suite = 'SF-A05-qualification';
  report.format = 'SharpForge.A05Qualification/1';
  report.measurementKind = 'runtime-qualification';
  report.targetScope = options.target ? {kind: 'selected-target', id: options.target} : {kind: 'suite', suite: options.suite};
  if (includes(options, 'fairness')) {
    report.unsupportedTargets = report.unsupportedTargets.filter(target => !target.startsWith('Wasm tier:'));
    report.protocol.tieredFairness = 'Separate CIL loop enables actual Node Wasm OSR; other rows retain their recorded tiering options.';
  }
  const controller = new AbortController();
  const forward = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) forward();
  else externalSignal?.addEventListener('abort', forward, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('Qualification time limit exceeded', 'TimeoutError')),
    options.timeoutSeconds * 1000);
  try {
    if (report.worktreeStatus) throw new Error('Commit the product and qualification harness before measurement');
    await runSuites({options, report, signal: controller.signal});
    report.status = report.errors.length ? 'failed' : 'measured';
  } catch (error) {
    report.status = controller.signal.aborted ? 'cancelled' : 'failed';
    report.errors.push(recordError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forward);
    const profilerIncluded = includes(options, 'profiler');
    if (profilerIncluded) report.profilerCoverage = profilerCoverage(report.rows, options.profilerMode ?? 'both');
    report.acceptance = qualificationAcceptance(report.rows, profilerIncluded ? requiredProfilerRows : []);
    completeReport(report);
    writeReport(report, options.out);
  }
  return report;
}

if (isMain(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort(new DOMException('Qualification cancelled', 'AbortError'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseQualificationOptions(process.argv.slice(2));
    const report = await runQualification(options, controller.signal);
    process.stdout.write(`${report.status} / ${report.acceptance}: ${options.out}\n`);
    process.exitCode = report.status !== 'measured' || report.acceptance === 'missed' ? 1 : report.acceptance === 'met' ? 0 : 2;
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
