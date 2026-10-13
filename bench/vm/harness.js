import {microbenchmarks, startupApps, snapshotCase, engines} from './fixtures.js';
import {compileFixture, abortIfNeeded} from './operations.js';
import {measureMicro} from './micro.js';
import {measureStartup} from './startup.js';
import {measureSnapshot, portableSnapshotsAvailable} from './snapshot.js';
import {executionPreparationCapabilities} from '@sharpforge/runtime';
import {validateReport} from './report-validation.js';
import {createReport, hash, stable, writeReport, recordError, completeReport, isMain} from './evidence.js';

export function parseOptions(args) {
  const values = {out: 'artifacts/a05-vm-performance.json', runner: '', samples: 100, warmup: 10,
    suite: 'all', engine: 'all', nativeBits: 32};
  const keys = {'--out': 'out', '--runner': 'runner', '--samples': 'samples', '--warmup': 'warmup',
    '--suite': 'suite', '--engine': 'engine', '--native-bits': 'nativeBits'};
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]], value = args[index + 1];
    if (args.slice(0, index).includes(args[index])) throw new TypeError('Duplicate benchmark option: ' + args[index]);
    if (!key || value === undefined || value.startsWith('--')) throw new TypeError('Unknown or missing option: ' + args[index]);
    values[key] = ['samples', 'warmup', 'nativeBits'].includes(key) ? Number(value) : value;
  }
  if (!Number.isInteger(values.samples) || values.samples < 20 || values.samples > 10000 ||
      !Number.isInteger(values.warmup) || values.warmup < 1 || values.warmup > 1000 ||
      ![32, 64].includes(values.nativeBits) || !['all', 'micro', 'startup', 'snapshot'].includes(values.suite) ||
      !['all', ...engines].includes(values.engine)) throw new RangeError('Invalid benchmark options');
  return values;
}

export function protocolFor(options) {
  return {version: 2, samples: options.samples, warmup: options.warmup, suite: options.suite,
    engines: options.engine === 'all' ? [...engines] : [options.engine],
    fixtureHash: hash(stable({microbenchmarks, startupApps, snapshotCase})),
    vmOptions: {nativeIntBits: options.nativeBits, maxInstructions: 20000000, sourceFusion: true,
      specializeNumericHandlers: true, typedNumericStack: false, smallLongs: true, wasmTiering: false},
    preparation: {source: executionPreparationCapabilities.source, reloaded: executionPreparationCapabilities.source,
      cil: executionPreparationCapabilities.cil}, portableSnapshots: portableSnapshotsAvailable(),
    scheduling: {workers: 1, sliceInstructions: 10000, sliceMs: 8, yield: 'setImmediate-between-nonterminal-slices'},
    gcPolicy: 'Exposed host GC before warm/snapshot observations, outside their timers; managed GC stays inside execution',
    warmPolicy: 'One prepared VM per micro case; initial snapshot restored and plans rebuilt outside execution timing. ' +
      'First execution and warmup samples are retained.',
    startupPolicy: 'Fresh Node process per observation. load is inspector parse, canonical reload, or source-image copy. ' +
      'Constructor includes its own required verification; verification is also reported separately. No subtraction.',
    memoryPolicy: 'Managed allocation counters exclude host graphs; hostBefore/hostAfter are process gauges, not allocation totals',
    snapshotPolicy: 'Populated 4096-element live array with a post-capture write; capture/local replay and available portable phases timed independently'};
}

export async function runHarness(options, signal) {
  const protocol = protocolFor(options), report = createReport(protocol, options.runner);
  const onRow = row => { report.rows.push(row); writeReport(report, options.out); };
  try {
    if (report.worktreeStatus) throw new Error('Commit benchmark changes before measurement; dirty baselines are not reproducible');
    const groups = [
      ['micro', microbenchmarks, measureMicro], ['startup', startupApps, measureStartup], ['snapshot', [snapshotCase], measureSnapshot],
    ];
    for (const [kind, fixtures, measure] of groups) {
      if (options.suite !== 'all' && options.suite !== kind) continue;
      for (const fixture of fixtures) {
        abortIfNeeded(signal);
        const started = performance.now(), artifact = compileFixture(fixture);
        const compilationMs = performance.now() - started;
        for (const engine of protocol.engines) {
          abortIfNeeded(signal);
          const row = await measure(fixture, engine, artifact, protocol, signal, onRow);
          row.compilationMs = compilationMs;
          row.assemblyHash = hash(artifact.assembly);
          writeReport(report, options.out);
        }
      }
    }
    report.status = 'measured';
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.errors.push(recordError(error));
  } finally {
    completeReport(report);
    if (report.status === 'measured') {
      try { validateReport(report); }
      catch (error) {
        report.status = 'failed';
        report.errors.push(recordError(error));
      }
    }
    writeReport(report, options.out);
  }
  return report;
}

if (isMain(import.meta.url)) {
  const abort = new AbortController();
  const cancel = () => abort.abort(new DOMException('Benchmark cancelled by signal', 'AbortError'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseOptions(process.argv.slice(2));
    const report = await runHarness(options, abort.signal);
    process.stdout.write(`${report.status}: ${options.out}\n`);
    process.exitCode = report.status === 'measured' ? 0 : 1;
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
