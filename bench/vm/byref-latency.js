import {existsSync} from 'node:fs';
import {parseLatencyOptions} from './latency-options.js';
import {compileFixture} from './operations.js';
import {createReport, completeReport, writeReport, recordError, isMain} from './evidence.js';
import {byrefLatencyFixture} from './byref-latency-fixture.js';
import {measureByrefLatency} from './byref-latency-measurement.js';

export const parseByrefLatencyOptions = arguments_ => parseLatencyOptions(arguments_, 'byref');

export async function runByrefLatency(options, signal) {
  if (existsSync(options.out)) throw new Error('Refusing to overwrite byref latency evidence');
  const protocol = {name: 'managed-byref-latency-v1', ...options, iterations: byrefLatencyFixture.iterations,
    depth: byrefLatencyFixture.depth, engines: ['source', 'reloaded', 'cil'],
    cold: 'Fresh VM per observation in one Node process using one compiled artifact; constructor/load, preparation, ' +
      'first complete execution and their total are separate. This is not process-cold startup.',
    warm: 'One prepared VM per engine; first execution and warmups retained; repeated entry admission is timed. No restore.',
    gc: 'Exposed host GC before observations outside timers; four explicit guest collections occur inside every workload.',
    allocations: 'Exact managed allocation/byte, collection and frame/array counters; host gauges are not JS allocation totals.',
    scope: 'Original #76 latency/allocation reporting only; no native throughput, speedup threshold or T12 baseline claim.'};
  const report = createReport(protocol, options.runner);
  report.format = 'SharpForge.ManagedByrefLatency/1';
  report.suite = 'SF-A05-T03';
  try {
    if (report.worktreeStatus) throw new Error('Byref latency measurement requires a clean committed worktree');
    const start = performance.now(), artifact = compileFixture(byrefLatencyFixture);
    report.fixtureCompilationMs = performance.now() - start;
    for (const engine of protocol.engines) {
      await measureByrefLatency(engine, artifact, options, signal, row => {
        report.rows.push(row);
        writeReport(report, options.out);
      });
      writeReport(report, options.out);
    }
    report.status = 'measured';
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.errors.push(recordError(error));
  } finally {
    completeReport(report);
    writeReport(report, options.out);
  }
  return report;
}

if (isMain(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Byref latency measurement cancelled', 'AbortError'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseByrefLatencyOptions(process.argv.slice(2));
    const report = await runByrefLatency(options, controller.signal);
    process.stdout.write(report.status + ': ' + options.out + '\n');
    process.exitCode = report.status === 'measured' ? 0 : 1;
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
