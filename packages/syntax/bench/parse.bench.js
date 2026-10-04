/**
 * Parse throughput and peak-memory benchmark: small, 1 MB and 10 MB documents plus huge-literal cases.
 *   node --expose-gc packages/syntax/bench/parse.bench.js            prints the measurements
 *   node --expose-gc packages/syntax/bench/parse.bench.js --update   rewrites parse.baseline.json
 *   node --expose-gc packages/syntax/bench/parse.bench.js --check    exits 1 when a case regressed by more than 15 percent
 *   Add --output <path> to retain the complete JSON report, including on a failed regression check.
 * Machines differ, so --check compares each case relative to a fixed calibration loop timed in the same run: the
 * figure checked is (case time / calibration time) against the same ratio in the baseline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyntaxTree, parse } from '../src/index.js';
import { benchmarkDocument } from './incremental.bench.js';
import { regressions } from './parse-regressions.js';
import { baselineDigest, captureEnvironment, parseOptions, writeReport } from './report.js';
export { regressions } from './parse-regressions.js';
const baselinePath = fileURLToPath(new URL('./parse.baseline.json', import.meta.url)),
  tolerance = 0.15;
const wrap = body => `class Literals\n{\n    void M()\n    {\n${body}\n    }\n}\n`;
/** The benchmark inputs by name. `quick` leaves out the 10 MB document. */
export function benchmarkCases(quick = false) {
  const cases = {
    small: benchmarkDocument(4_000),
    oneMegabyte: benchmarkDocument(1_000_000),
    hugeString: wrap('        var s = "' + 'lorem ipsum \\n'.repeat(80_000) + '";'),
    hugeVerbatimString: wrap('        var s = @"' + 'line of text\n'.repeat(80_000) + '";'),
    hugeRawString: wrap('        var s = """\n' + '            raw "text" line\n'.repeat(40_000) + '            """;'),
    hugeInterpolatedString: wrap('        var s = $"' + 'a{b}c{d:X2}'.repeat(40_000) + '";'),
    hugeNumber: wrap('        var n = ' + '1234567890'.repeat(10_000) + ';'),
    hugeArrayInitializer: wrap('        var a = new int[] { ' + '12345, '.repeat(150_000) + '0 };'),
    hugeComment: wrap('        /* ' + 'comment text '.repeat(80_000) + '*/'),
    longBinaryChain: wrap('        var x = 1' + ' + 1'.repeat(100_000) + ';')
  };
  if (!quick) cases.tenMegabytes = benchmarkDocument(10_000_000);
  return cases;
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)],
  median = values => percentile(values, 0.5),
  round = value => Math.round(value * 100) / 100;
const collect = () => {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed;
};
/** A fixed CPU-bound loop (string scanning and object allocation) whose time scales with the machine like parsing does. */
export function calibrate() {
  const text = 'abcdefghij klmnopqrst '.repeat(50_000),
    times = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    let sum = 0;
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 32) out.push({ at: i, sum });
      else sum = (sum * 31 + c) | 0;
    }
    times.push(performance.now() - start);
    if (out.length < 2) throw new Error('calibration');
  }
  return median(times);
}
export function measure({ quick = false, runs = 3 } = {}) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new RangeError('Parse benchmark runs must be between 1 and 100');
  const calibrationMs = calibrate(),
    gcExposed = typeof globalThis.gc === 'function',
    results = {};
  for (const [name, text] of Object.entries(benchmarkCases(quick))) {
    const megabytes = text.length / 1_048_576,
      times = [],
      count = megabytes > 5 ? 1 : runs;
    let tree = null,
      peak = 0;
    const before = collect();
    for (let run = 0; run < count; run++) {
      tree = null;
      const start = performance.now();
      tree = SyntaxTree.parseText(text);
      times.push(performance.now() - start);
      peak = Math.max(peak, process.memoryUsage().heapUsed - before);
    }
    if (tree.toFullString() !== text) throw new Error('round-trip failed for ' + name);
    const retained = collect() - before,
      ms = median(times);
    let legacyMs = null;
    if (megabytes <= 2) {
      const start = performance.now();
      parse(text);
      legacyMs = performance.now() - start;
    }
    tree = null;
    results[name] = {
      characters: text.length,
      parseMs: round(ms),
      firstParseMs: round(times[0]),
      parseP95Ms: round(percentile(times, 0.95)),
      parseP99Ms: round(percentile(times, 0.99)),
      samplesMs: times.map(round),
      warmupRuns: 0,
      megabytesPerSecond: round(megabytes / (ms / 1000)),
      relativeToCalibration: round(ms / calibrationMs),
      retainedHeapMB: gcExposed ? round(Math.max(0, retained) / 1_048_576) : null,
      peakHeapMB: gcExposed ? round(Math.max(0, peak) / 1_048_576) : null,
      parseWithLegacyAstMs: legacyMs === null ? null : round(legacyMs)
    };
  }
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    calibrationMs: round(calibrationMs),
    processPeakRssMB: round(process.resourceUsage().maxRSS / 1024),
    memorySemantics: {
      retainedHeapMB: 'Live V8 heap growth after explicit GC while retaining the syntax tree; null without --expose-gc.',
      peakHeapMB: 'Maximum V8 heap growth sampled after each synchronous parse; not the unsampled allocation peak.',
      processPeakRssMB: 'Process lifetime maximum resident set, including corpus, runtime and benchmark harness.',
      allocationCount: 'Not measured.'
    },
    cases: results
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2)),
    result = measure(options);
  result.environment = captureEnvironment(fileURLToPath(new URL('../../../', import.meta.url)));
  if (options.update) writeFileSync(baselinePath, JSON.stringify(result, null, 1) + '\n');
  if (options.check) {
    const baselineText = readFileSync(baselinePath, 'utf8'),
      failed = regressions(result, JSON.parse(baselineText));
    result.gate = {
      baselinePath: 'packages/syntax/bench/parse.baseline.json',
      baselineSha256: baselineDigest(baselineText),
      tolerance,
      passed: failed.length === 0,
      failures: failed
    };
    for (const entry of failed)
      console.error(entry.message ? `${entry.name}: ${entry.message}` :
        `${entry.name}: ${entry.change}% slower than the baseline (calibrated ${entry.current} vs ${entry.baseline})`);
    if (failed.length) process.exitCode = 1;
  }
  if (options.output) writeReport(options.output, result);
  console.log(JSON.stringify(result, null, 1));
}
