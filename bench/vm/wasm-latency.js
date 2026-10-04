import {parseQualificationOptions} from './qualification-options.js';
import {wasmLatencyFixtures} from './wasm-latency-fixtures.js';
import {measureWasmLatency} from './wasm-latency-measure.js';
import {createReport, completeReport, writeReport, recordError, isMain} from './evidence.js';

const allowed = new Set(['--runner', '--out', '--samples', '--warmup', '--native-bits', '--timeout-seconds', '--seed']);

/** Reuse the qualification bounds; this additive report has no target selection or performance threshold. */
export function parseWasmLatencyOptions(args) {
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index])) throw new TypeError('Unknown Wasm latency option: ' + args[index]);
  }
  return parseQualificationOptions(args);
}

export async function runWasmLatencyReport(options, externalSignal) {
  if (existsSync(options.out)) throw new Error('Refusing to overwrite Wasm latency evidence');
  const protocol = {version: 1, samples: options.samples, warmup: options.warmup, nativeBits: options.nativeBits,
    timeoutSeconds: options.timeoutSeconds, iterations: 1024,
    cold: 'Each observation creates a fresh VM. constructor-to-ready includes verification, eligibility, IR, encoding and async instantiate. ' +
      'The initial frame executes no guest instruction before readiness. The platform Wasm cache is not reset: these are VM-cold, in-process samples.',
    priming: 'Each initial frame remains interpreted. Its complete execution is recorded separately, outside cold and compiled timers.',
    firstCompiled: 'Every fresh context reenters its ready method once; this complete call includes frame admission.',
    warmCompiled: 'One final context retains its compiled method and pooled frames across complete calls; no restore or invalidation.',
    exclusions: 'First observation and configured warmups are retained but excluded from each phase summary. ' +
      'Fixture assembly, interpreter oracle, native-arithmetic proof and exposed host GC are outside measured intervals.',
    backend: 'Automatic call-entry tier, OSR disabled. Selected instructions include canonical imported helpers; ' +
      'an untimed whole-call probe rejects interpreter arithmetic to prove actual native Wasm work.',
    counters: 'Exact managed allocations/bytes, frame/array allocations and offset-map allocations within each phase. ' +
      'Cold counters start before VM construction; compiled counters include reentry admission. Encoded compiledBytes is a code-size counter. ' +
      'Process host-memory fields are gauges, not total JS/native allocation counts; native compilation allocations are unavailable.',
    summary: 'Raw observations and linear-interpolated p50/median, p95 and p99; no speedup or regression threshold is introduced.'};
  const report = createReport(protocol, options.runner);
  report.suite = 'SF-A05-Wasm-latency';
  report.format = 'SharpForge.A05WasmLatency/1';
  report.measurementKind = 'wasm-latency';
  report.performanceGate = null;
  report.unsupportedTargets = report.unsupportedTargets.filter(target => !target.startsWith('Wasm tier:'));
  report.unsupportedTargets.push('OSR latency: separate tiered fairness evidence measures the selected OSR path');
  const controller = new AbortController(), forward = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) forward();
  else externalSignal?.addEventListener('abort', forward, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('Wasm latency time limit exceeded', 'TimeoutError')),
    options.timeoutSeconds * 1000);
  try {
    if (report.worktreeStatus) throw new Error('Commit the product and benchmark harness before measurement');
    for (const fixture of wasmLatencyFixtures()) {
      let row;
      try {
        row = await measureWasmLatency(fixture, options, controller.signal, progress => {
          if (report.rows.at(-1) !== progress) report.rows.push(progress);
          writeReport(report, options.out);
        });
      } catch (error) {
        row = error.evidence ?? {id: fixture.id, status: controller.signal.aborted ? 'cancelled' : 'failed'};
        row.error = recordError(error);
        report.errors.push({id: fixture.id, ...row.error});
      }
      if (report.rows.at(-1) !== row) report.rows.push(row);
      writeReport(report, options.out);
      if (controller.signal.aborted) throw controller.signal.reason;
    }
    report.status = report.errors.length ? 'failed' : 'measured';
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
  const controller = new AbortController(), cancel = () => controller.abort(new DOMException('Wasm latency cancelled', 'AbortError'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseWasmLatencyOptions(process.argv.slice(2));
    const report = await runWasmLatencyReport(options, controller.signal);
    process.stdout.write(`${report.status}: ${options.out}\n`);
    process.exitCode = report.status === 'measured' ? 0 : 1;
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
import {existsSync} from 'node:fs';
