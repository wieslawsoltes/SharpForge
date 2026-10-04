import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {findContracts} from '@sharpforge/framework';
import {stopwatchPlatform} from './fixtures/stopwatch.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('time-span-totals-net10.json', directory), 'utf8'));

for (const engine of ['source', 'cil']) {
  test(`TimeSpan ${engine}: native exact-tick totals are independent of the compatibility milliseconds slot`, () => {
    const watch = stopwatchPlatform(engine);
    const {platform, span} = watch;
    try {
      for (const row of native.rows) {
        const reference = platform.make('System.TimeSpan', {'$ticks': BigInt(row.ticks), TotalMilliseconds: platform.managed(42, 'double')});
        assert.equal(span(reference), Number(row.totalMilliseconds));
        assert.equal(span(reference, 'TotalSeconds'), Number(row.totalSeconds));
      }
      const value = platform.make('System.TimeSpan', {'$ticks': 12_345_678_901_234_568n});
      const handle = platform.heap.createHandle(value);
      const saved = watch.vm.snapshot();
      const expected = span(value, 'TotalSeconds');
      platform.set(value, '$ticks', 0n); watch.vm.restore(saved); platform.heap.collect();
      assert.equal(span(value, 'TotalSeconds'), expected);
      const allocations = platform.heap.stats.allocations;
      const budget = platform.heap.maxBytes;
      platform.heap.maxBytes = 1;
      try { assert.equal(span(value), Number(12_345_678_901_234_568n) / 10_000); }
      finally { platform.heap.maxBytes = budget; }
      assert.equal(platform.heap.stats.allocations, allocations);
      platform.heap.releaseHandle(handle);
    } finally { watch.stop(); }
  });

  test(`TimeSpan ${engine}: Zero and every existing factory retain their legacy values, bounds and storage`, () => {
    const watch = stopwatchPlatform(engine);
    const {platform, span} = watch;
    try {
      const zero = platform.invoke(findContracts('System.TimeSpan', 'get_Zero')[0], []);
      assert.equal(span(zero), 0);
      assert.equal(span(zero, 'TotalSeconds'), 0);
      assert.equal(platform.get(zero, '$ticks'), null);
      for (const [name, multiplier] of [['FromMilliseconds', 1], ['FromSeconds', 1000], ['FromMinutes', 60000]]) {
        const descriptor = findContracts('System.TimeSpan', name)[0];
        for (const value of [-123.456789, -0.0001, 0, 0.0001, 123.456789, 1e12 / multiplier, -1e12 / multiplier]) {
          const reference = platform.invoke(descriptor, [platform.managed(value, 'double')]);
          assert.equal(span(reference), value * multiplier);
          assert.equal(span(reference, 'TotalSeconds'), value * multiplier / 1000);
          assert.equal(platform.get(reference, '$ticks'), null);
        }
        for (const value of [NaN, Infinity, -Infinity, 2e12 / multiplier, -2e12 / multiplier]) {
          assert.throws(() => platform.invoke(descriptor, [platform.managed(value, 'double')]), {name: 'ArgumentOutOfRangeException'});
        }
      }
      const legacy = platform.make('System.TimeSpan', {TotalMilliseconds: platform.managed(1.23456789, 'double')});
      assert.equal(span(legacy), 1.23456789);
      assert.equal(span(legacy, 'TotalSeconds'), 1.23456789 / 1000);
    } finally { watch.stop(); }
  });

  test(`TimeSpan ${engine}: corrupt private tick payloads are bounded managed faults`, () => {
    const watch = stopwatchPlatform(engine);
    try {
      for (const ticks of [NaN, Infinity, 1, '1', 9_223_372_036_854_775_808n, -9_223_372_036_854_775_809n]) {
        const reference = watch.platform.make('System.TimeSpan', {'$ticks': ticks});
        assert.throws(() => watch.span(reference), {name: 'InvalidOperationException'});
        assert.throws(() => watch.span(reference, 'TotalSeconds'), {name: 'InvalidOperationException'});
      }
    } finally { watch.stop(); }
  });
}

test('TimeSpan exact totals reference retains pinned .NET provenance and full Int64 boundaries', () => {
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 19);
  assert.equal(native.rows[0].ticks, '-9223372036854775808');
  assert.equal(native.rows.at(-1).ticks, '9223372036854775807');
  const source = readFileSync(new URL('time-span-totals/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
