import test from 'node:test';
import assert from 'node:assert/strict';
import { runPackMemoryBenchmark } from '../packages/git/bench/pack-memory.js';
import { packMemoryProfile, PACK_MEMORY_MINIMUM_BYTES } from '../packages/git/bench/pack-memory-profile.js';
import { gitAvailability } from './git-conformance/native.js';

test('pack memory fixture has an actual 100 MiB default payload and rejects unbounded profiles', () => {
  const profile = packMemoryProfile();
  assert.equal(profile.objects * profile.objectBytes, PACK_MEMORY_MINIMUM_BYTES);
  assert.throws(() => packMemoryProfile({ objects: 0 }), RangeError);
  assert.throws(() => packMemoryProfile({ objectBytes: 2 * 1024 * 1024 + 1 }), RangeError);
  assert.throws(() => packMemoryProfile({ objects: 8192, objectBytes: 2 * 1024 * 1024 }), RangeError);
  assert.throws(() => packMemoryProfile({ seed: 0 }), RangeError);
  assert.throws(() => packMemoryProfile({ algorithm: 'sha512' }), RangeError);
});

test('reduced pack fixture exercises isolated decoding and native verification without claiming 100 MiB qualification',
  { timeout: 90_000 }, async context => {
    const availability = await gitAvailability();
    if (!availability.available) { context.skip(availability.reason); return; }
    const report = await runPackMemoryBenchmark({ objects: 4, objectBytes: 256 * 1024, timeoutMs: 60_000 });
    assert.equal(report.ok, true);
    assert.equal(report.qualifyingProfile, false);
    assert.equal(report.qualifies100MiB, false);
    assert.equal(report.pack.objects, 4);
    assert.equal(report.pack.expandedBytes, 1024 * 1024);
    assert.ok(report.pack.bytes > report.pack.expandedBytes);
    assert.equal(report.reference.packIndexVerified, true);
    assert.equal(report.reference.looseObjectsVerified, true);
    assert.equal(report.memory.peak.heapUsedBytes < report.heapLimitBytes, true);
    assert.ok(report.memory.peak.externalBytes > 0);
    assert.ok(report.memory.peak.arrayBufferBytes > 0);
    assert.ok(report.memory.processPeakRssBytes >= report.memory.peak.rssBytes);
    assert.ok(report.memory.samples > 4);
    context.diagnostic(`SHARPFORGE_GIT_PACK_MEMORY_REDUCED ${JSON.stringify(report)}`);
  });

test('cancelled pack qualification starts no fixture worker', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(runPackMemoryBenchmark({ signal }), /cancelled/);
});
