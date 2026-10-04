import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReport, completeReport, hash, isMain, recordError, root} from './evidence.js';
import {parseFloatAllocationTrace, assessFloatAllocation} from './float-allocation-trace.js';
import {floatAllocationCounterSupported} from './float-allocation-instrumentation.js';

/** One bounded isolated child, with full GC trace retained by the caller. */
export function measureFloatAllocation(mode, iterations, warmup = 100000, warmupSlices = 1) {
  if (!['typed', 'mixed', 'reference'].includes(mode) || !Number.isInteger(iterations) || iterations < 0 || iterations > 1000000 ||
      !Number.isInteger(warmup) || warmup < 1 || warmup > 100000 || !Number.isInteger(warmupSlices) ||
      warmupSlices < 1 || warmupSlices > Math.min(10000, warmup)) throw new RangeError('Invalid float measurement options');
  if (!floatAllocationCounterSupported) {
    throw Object.assign(new Error('Exact float instrumentation requires Node 22.15 or newer'), {code: 'FLOAT_INSTRUMENTATION_UNSUPPORTED'});
  }
  const worker = fileURLToPath(new URL('./float-allocation-worker.js', import.meta.url));
  const command = ['--max-old-space-size=512', '--expose-gc', '--trace-gc-nvp', worker,
    mode, String(iterations), String(warmup), String(warmupSlices)];
  const child = spawnSync(process.execPath, command, {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024});
  const trace = (child.stdout ?? '') + (child.stderr ?? '');
  if (child.error || child.status !== 0) {
    const error = child.error ?? new Error(`Float child failed: ${child.status}/${child.signal}\n${trace.slice(-8000)}`);
    error.trace = trace;
    throw error;
  }
  return {row: {...parseFloatAllocationTrace(trace), command: [process.execPath, ...command], traceSHA256: hash(trace)}, trace};
}

export function floatAllocationOptions(arguments_) {
  const options = {iterations: 1000000, warmup: 100000, warmupSlices: 1};
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    if (!['--runner', '--out', '--iterations', '--warmup', '--warmup-slices'].includes(name) ||
        arguments_[index + 1] === undefined || seen.has(name)) {
      throw new TypeError('Expected --runner ID --out FILE [--iterations N] [--warmup N] [--warmup-slices N]');
    }
    seen.add(name);
    const key = name === '--warmup-slices' ? 'warmupSlices' : name.slice(2);
    if (key === 'runner' || key === 'out') options[key] = arguments_[index + 1];
    else options[key] = Number(arguments_[index + 1]);
  }
  if (!options.runner || !options.out || !Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 1000000 ||
      !Number.isInteger(options.warmup) || options.warmup < 1 || options.warmup > 100000 || !Number.isInteger(options.warmupSlices) ||
      options.warmupSlices < 1 || options.warmupSlices > Math.min(10000, options.warmup)) {
    throw new RangeError('Invalid float qualification options');
  }
  return options;
}

function main() {
  const options = floatAllocationOptions(process.argv.slice(2));
  const destination = resolve(options.out);
  if (existsSync(destination)) throw new Error('Refusing to overwrite allocation evidence');
  const report = createReport({name: 'float-allocation-v1', ...options}, options.runner);
  report.format = 'SharpForge.FloatAllocation/1';
  report.suite = 'SF-A05-T08.1';
  if (report.worktreeStatus) throw new Error('Float qualification requires a clean committed worktree');
  mkdirSync(dirname(destination), {recursive: true});
  try {
    for (const mode of ['typed', 'mixed']) {
      const rows = [];
      for (const iterations of [0, Math.min(100000, options.iterations), options.iterations].filter((item, index, all) => all.indexOf(item) === index)) {
        const {row, trace} = measureFloatAllocation(mode, iterations, options.warmup, options.warmupSlices);
        const tracePath = destination + '.' + mode + '.' + iterations + '.log';
        writeFileSync(tracePath, trace, {flag: 'wx'});
        rows.push({...row, tracePath});
      }
      report.rows.push({mode, control: rows[0], samples: rows.slice(1), assessment: assessFloatAllocation(rows[0], rows.slice(1))});
    }
    const negative = measureFloatAllocation('reference', Math.min(10000, options.iterations),
      Math.min(10000, options.warmup), options.warmupSlices);
    const tracePath = destination + '.reference.log';
    writeFileSync(tracePath, negative.trace, {flag: 'wx'});
    report.positiveAllocationControl = {...negative.row, tracePath};
    if (negative.row.floatCarriers <= 0) throw new Error('Generic float control did not detect any carrier allocations');
    report.status = 'measured';
    report.acceptance = 'partial';
    report.limit = 'Exact zero float carriers can be established; total JS object count remains unqualified by this trace protocol.';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(recordError(error));
    if (error.trace) writeFileSync(destination + '.failed.log', error.trace, {flag: 'wx'});
  }
  completeReport(report);
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.exitCode = report.status === 'failed' ? 1 : 2;
}

if (isMain(import.meta.url)) main();
