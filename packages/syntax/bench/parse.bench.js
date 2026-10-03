/**
 * Parse throughput and peak-memory benchmark: small, 1 MB and 10 MB documents plus huge-literal cases.
 *   node --expose-gc packages/syntax/bench/parse.bench.js            prints the measurements
 *   node --expose-gc packages/syntax/bench/parse.bench.js --update   rewrites parse.baseline.json
 *   node --expose-gc packages/syntax/bench/parse.bench.js --check    exits 1 when a case regressed by more than 15 percent
 * Machines differ, so --check compares each case relative to a fixed calibration loop timed in the same run: the
 * figure checked is (case time / calibration time) against the same ratio in the baseline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyntaxTree, parse } from '../src/index.js';
import { benchmarkDocument } from './incremental.bench.js';
const baselinePath = fileURLToPath(new URL('./parse.baseline.json', import.meta.url)), tolerance = 0.15;
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
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1], round = value => Math.round(value * 100) / 100;
const collect = () => { if (typeof globalThis.gc === 'function') globalThis.gc(); return process.memoryUsage().heapUsed; };
/** A fixed CPU-bound loop (string scanning and object allocation) whose time scales with the machine like parsing does. */
export function calibrate() {
  const text = 'abcdefghij klmnopqrst '.repeat(50_000), times = [];
  for (let run = 0; run < 5; run++) { const start = performance.now(); let sum = 0; const out = []; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 32) out.push({ at: i, sum }); else sum = (sum * 31 + c) | 0; } times.push(performance.now() - start); if (out.length < 2) throw new Error('calibration'); }
  return median(times);
}
export function measure({ quick = false, runs = 3 } = {}) {
  const calibrationMs = calibrate(), results = {};
  for (const [name, text] of Object.entries(benchmarkCases(quick))) {
    const megabytes = text.length / 1_048_576, times = [], count = megabytes > 5 ? 1 : runs; let tree = null, peak = 0; const before = collect();
    for (let run = 0; run < count; run++) { tree = null; const start = performance.now(); tree = SyntaxTree.parseText(text); times.push(performance.now() - start); peak = Math.max(peak, process.memoryUsage().heapUsed - before); }
    if (tree.toFullString().length !== text.length) throw new Error('round-trip failed for ' + name);
    const retained = collect() - before, ms = median(times); let legacyMs = null;
    if (megabytes <= 2) { const start = performance.now(); parse(text); legacyMs = performance.now() - start; }
    tree = null;
    results[name] = { characters: text.length, parseMs: round(ms), megabytesPerSecond: round(megabytes / (ms / 1000)), relativeToCalibration: round(ms / calibrationMs), retainedHeapMB: round(Math.max(0, retained) / 1_048_576), peakHeapMB: round(peak / 1_048_576), parseWithLegacyAstMs: legacyMs === null ? null : round(legacyMs) };
  }
  return { node: process.version, platform: `${process.platform} ${process.arch}`, calibrationMs: round(calibrationMs), cases: results };
}
/** Cases whose calibrated time exceeds the baseline's by more than the tolerance: [{ name, baseline, current, change }]. */
export function regressions(current, baseline, limit = tolerance) {
  const out = [];
  for (const [name, entry] of Object.entries(current.cases)) { const reference = baseline.cases[name]; if (!reference) continue; const change = entry.relativeToCalibration / reference.relativeToCalibration - 1; if (change > limit && entry.parseMs - reference.parseMs > 2) out.push({ name, baseline: reference.relativeToCalibration, current: entry.relativeToCalibration, change: round(change * 100) }); }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = measure({ quick: process.argv.includes('--quick') }); console.log(JSON.stringify(result, null, 1));
  if (process.argv.includes('--update')) writeFileSync(baselinePath, JSON.stringify(result, null, 1) + '\n');
  if (process.argv.includes('--check')) {
    const failed = regressions(result, JSON.parse(readFileSync(baselinePath, 'utf8')));
    for (const entry of failed) console.error(`${entry.name}: ${entry.change}% slower than the baseline (calibrated ${entry.current} vs ${entry.baseline})`);
    if (failed.length) process.exitCode = 1;
  }
}
