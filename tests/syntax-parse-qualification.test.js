import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { regressions } from '../packages/syntax/bench/parse-regressions.js';
import { baselineDigest, parseOptions, writeReport } from '../packages/syntax/bench/report.js';

function measurement(overrides = {}) {
  return {
    cases: {
      small: {
        characters: 10_000,
        parseMs: 1,
        megabytesPerSecond: 10,
        relativeToCalibration: 1,
        retainedHeapMB: 1,
        peakHeapMB: 2,
        ...overrides
      }
    }
  };
}

test('syntax parse qualification checks the 15 percent boundary even for sub-two-millisecond regressions', () => {
  const baseline = measurement();
  assert.deepEqual(regressions(baseline, baseline), []);
  assert.deepEqual(regressions(measurement({ parseMs: 1.15, relativeToCalibration: 1.15 }), baseline), []);
  assert.deepEqual(regressions(measurement({ parseMs: 0.5, relativeToCalibration: 0.5 }), baseline), []);
  const failed = regressions(measurement({ parseMs: 1.16, relativeToCalibration: 1.16 }), baseline);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'small');
  assert.equal(failed[0].change, 16);
});

test('syntax parse qualification rejects missing, additional and changed input cases', () => {
  const baseline = measurement();
  assert.match(regressions({ cases: {} }, baseline)[0].message, /current case is missing/);
  const extra = measurement();
  extra.cases.extra = extra.cases.small;
  assert.match(regressions(extra, baseline)[0].message, /baseline case is missing/);
  assert.match(regressions(measurement({ characters: 20_000 }), baseline)[0].message, /Input size changed/);
  assert.match(regressions(baseline, { cases: {} })[0].message, /baseline must contain/);
  assert.match(regressions(null, baseline)[0].message, /measurement must contain/);
});

test('syntax parse qualification rejects malformed metrics instead of silently passing NaN comparisons', () => {
  const baseline = measurement();
  for (const value of [NaN, Infinity, -Infinity, 0, -1, null, '1']) {
    assert.equal(regressions(measurement({ relativeToCalibration: value }), baseline).length, 1, String(value));
    assert.equal(regressions(baseline, measurement({ relativeToCalibration: value })).length, 1, String(value));
  }
  for (const metric of ['parseMs', 'megabytesPerSecond', 'retainedHeapMB', 'peakHeapMB'])
    assert.match(regressions(measurement({ [metric]: null }), baseline)[0].message, new RegExp(metric));
  assert.deepEqual(regressions(measurement({ retainedHeapMB: 0, peakHeapMB: 0 }), baseline), []);
  for (const value of [NaN, Infinity, -0.1, 2]) assert.throws(() => regressions(baseline, baseline, value), RangeError);
});

test('syntax parse qualification cannot update its own baseline or silently skip the ten-megabyte case', () => {
  assert.deepEqual(parseOptions(['--check', '--output', 'artifacts/parse.json']), {
    quick: false, check: true, update: false, output: 'artifacts/parse.json'
  });
  assert.throws(() => parseOptions(['--check', '--update']), /cannot be combined/);
  assert.throws(() => parseOptions(['--check', '--quick']), /requires all cases/);
  assert.throws(() => parseOptions(['--output']), /requires a path/);
  assert.throws(() => parseOptions(['--output', '--check']), /requires a path/);
  assert.throws(() => parseOptions(['--quik']), /Unknown/);
});

test('syntax parse qualification preserves a failed verdict and the exact baseline digest in its artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'sharpforge-syntax-qualification-'));
  try {
    const text = JSON.stringify(measurement()),
      result = { gate: { passed: false, baselineSha256: baselineDigest(text), failures: [{ name: 'small', change: 16 }] } },
      path = join(root, 'nested', 'parse.json');
    assert.match(result.gate.baselineSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(baselineDigest(text), baselineDigest(text + '\n'));
    writeReport(path, result);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), result);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
