import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './support/syntax-reference.js';
import { measure, regressions, benchmarkCases, calibrate } from '../packages/syntax/bench/parse.bench.js';

// SF-A01-T12.4: throughput and peak-memory baselines for small, 1 MB and 10 MB inputs and huge-literal cases, with a
// check that fails on a regression of more than 15 percent.
const baseline = JSON.parse(readFileSync(join(repoRoot, 'packages/syntax/bench/parse.baseline.json'), 'utf8'));
test('parse bench: the committed baseline covers small, 1 MB, 10 MB and huge-literal inputs', () => {
  const names = Object.keys(baseline.cases); for (const name of ['small', 'oneMegabyte', 'tenMegabytes', 'hugeString', 'hugeVerbatimString', 'hugeRawString', 'hugeInterpolatedString', 'hugeNumber', 'hugeArrayInitializer', 'hugeComment', 'longBinaryChain']) assert(names.includes(name), name);
  assert(baseline.cases.oneMegabyte.characters >= 1_000_000 && baseline.cases.tenMegabytes.characters >= 10_000_000); assert(baseline.calibrationMs > 0 && baseline.node && baseline.platform);
  for (const [name, entry] of Object.entries(baseline.cases)) for (const key of ['parseMs', 'megabytesPerSecond', 'relativeToCalibration', 'retainedHeapMB', 'peakHeapMB']) assert(typeof entry[key] === 'number' && entry[key] >= 0, `${name}.${key}`);
  assert.deepEqual(Object.keys(benchmarkCases(false)).sort(), names.sort()); assert(!('tenMegabytes' in benchmarkCases(true)));
});
test('parse bench: the regression check fails beyond 15 percent and passes within it', () => {
  const scale = factor => ({ ...baseline, cases: Object.fromEntries(Object.entries(baseline.cases).map(([name, entry]) => [name, { ...entry, parseMs: entry.parseMs * factor, relativeToCalibration: entry.relativeToCalibration * factor }])) });
  assert.deepEqual(regressions(baseline, baseline), []); assert.deepEqual(regressions(scale(1.1), baseline), []); assert.deepEqual(regressions(scale(0.5), baseline), []);
  const slow = regressions(scale(1.3), baseline).map(r => r.name); assert(slow.includes('oneMegabyte') && slow.includes('tenMegabytes') && slow.includes('hugeArrayInitializer'), slow.join(','));
  assert(regressions(scale(1.3), baseline).every(r => r.change >= 29 && r.change <= 31)); assert(calibrate() > 0);
});
test('parse bench: the quick measurement runs every case and produces comparable figures', () => {
  const result = measure({ quick: true, runs: 1 }); assert.deepEqual(Object.keys(result.cases).sort(), Object.keys(benchmarkCases(true)).sort());
  for (const [name, entry] of Object.entries(result.cases)) { assert(entry.parseMs > 0 && entry.megabytesPerSecond > 0, name); assert(Number.isFinite(entry.relativeToCalibration)); }
  assert(result.cases.oneMegabyte.megabytesPerSecond > 0.5, 'a 1 MB document parses at more than 0.5 MB/s even on a slow machine');
});
