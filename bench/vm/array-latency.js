import {existsSync} from 'node:fs';
import {compileFixture} from './operations.js';
import {createReport, completeReport, writeReport, recordError, isMain} from './evidence.js';
import {parseLatencyOptions} from './latency-options.js';
import {measureCompleteWorkload} from './complete-workload-latency.js';
import {arrayLatencyFixtures} from './array-latency-fixtures.js';
import {checkQualificationLimit} from './qualification-execution.js';

export const parseArrayLatencyOptions = arguments_ => parseLatencyOptions(arguments_, 'array');

export function measureArrayLatency(definition, engine, artifact, options, execution = {}) {
  return measureCompleteWorkload({fixture: definition.fixture, rowPrefix: 'array-latency-' + definition.fixture.id},
    engine, artifact, options, execution);
}

/** Complete cold/warm array observations are additive evidence, not a new threshold or T12 baseline. */
export async function runArrayLatency(options, externalSignal) {
  if (existsSync(options.out)) throw new Error('Refusing to overwrite array latency evidence');
  const protocol = {name: 'array-latency-v1', samples: options.samples, warmup: options.warmup, nativeBits: options.nativeBits,
    timeoutSeconds: options.timeoutSeconds, engines: ['source', 'reloaded', 'cil'],
    fixtures: arrayLatencyFixtures.map(({fixture, kind, work}) => ({id: fixture.id, kind, work})),
    cold: 'Fresh VM per observation within one Node process using one compiled artifact per fixture. ' +
      'Constructor/load, preparation, first complete execution and total are separate. This is not process-cold startup.',
    warm: 'One prepared VM per fixture/engine. First execution and warmups are retained but excluded from summaries. ' +
      'Each measured complete reentry includes frame admission; caches/pools remain warm without restore or invalidation.',
    gc: 'Exposed host GC precedes observations outside timers; managed collections remain inside complete guest execution.',
    allocations: 'Exact managed allocations/bytes, collections and frame/array counters; process host-memory gauges ' +
      'are not JS allocation totals. Cold counters start before construction; warm counters include entry admission.',
    summary: 'Raw observations and p50/median, p95, p99; no speedup threshold is introduced.',
    scope: 'Original #78 cold/warm array reporting. Runtime construction and complete successful array work are measured; ' +
      'fault timing, arbitrary ranks/lower bounds, native throughput and browser timing are not qualified by this report.'};
  const report = createReport(protocol, options.runner);
  report.format = 'SharpForge.ArrayLatency/1';
  report.suite = 'SF-A05-T05';
  report.measurementKind = 'array-latency';
  report.performanceGate = null;
  report.fixtureCompilations = [];
  const deadline = performance.now() + options.timeoutSeconds * 1000;
  const controller = new AbortController();
  const forward = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) forward();
  else externalSignal?.addEventListener('abort', forward, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('Array latency time limit exceeded', 'TimeoutError')),
    options.timeoutSeconds * 1000);
  try {
    if (report.worktreeStatus) throw new Error('Array latency measurement requires a clean committed worktree');
    for (const definition of arrayLatencyFixtures) {
      checkQualificationLimit(deadline, controller.signal);
      const started = performance.now(), artifact = compileFixture(definition.fixture);
      report.fixtureCompilations.push({fixture: definition.fixture.id, compilationMs: performance.now() - started});
      for (const engine of protocol.engines) {
        await measureArrayLatency(definition, engine, artifact, options, {signal: controller.signal, deadline, onProgress(row) {
          report.rows.push(row);
          writeReport(report, options.out);
        }});
        writeReport(report, options.out);
      }
    }
    report.status = 'measured';
  } catch (error) {
    report.status = controller.signal.aborted ? 'cancelled' : 'failed';
    report.errors.push(recordError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forward);
    completeReport(report);
    writeReport(report, options.out);
  }
  return report;
}

if (isMain(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Array latency measurement cancelled', 'AbortError'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseArrayLatencyOptions(process.argv.slice(2));
    const report = await runArrayLatency(options, controller.signal);
    process.stdout.write(report.status + ': ' + options.out + '\n');
    process.exitCode = report.status === 'measured' ? 0 : 1;
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
