import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireRunSlot, limitTestArgs, limitedEnv, resourceLimits} from '../scripts/planning/lib/resource-limits.js';

const GIB = 1024 ** 3;

test('resource limits: local defaults scale with memory and CI is unlimited', () => {
  assert.deepEqual(resourceLimits({}, 18 * GIB), {testConcurrency: 2, parallelRuns: 2, maxOldSpaceMb: 2048});
  assert.deepEqual(resourceLimits({}, 4 * GIB), {testConcurrency: 1, parallelRuns: 1, maxOldSpaceMb: 2048});
  assert.deepEqual(resourceLimits({}, 128 * GIB), {testConcurrency: 4, parallelRuns: 4, maxOldSpaceMb: 2048});
  assert.deepEqual(resourceLimits({CI: 'true'}, 18 * GIB), {testConcurrency: null, parallelRuns: null, maxOldSpaceMb: null});
});

test('resource limits: environment overrides win and invalid values are ignored', () => {
  const env = {SHARPFORGE_TEST_CONCURRENCY: '6', SHARPFORGE_MAX_PARALLEL_RUNS: '3', SHARPFORGE_MAX_OLD_SPACE_MB: '512', CI: 'true'};
  assert.deepEqual(resourceLimits(env, 18 * GIB), {testConcurrency: 6, parallelRuns: 3, maxOldSpaceMb: 512});
  assert.equal(resourceLimits({SHARPFORGE_TEST_CONCURRENCY: '0'}, 16 * GIB).testConcurrency, 2);
  assert.equal(resourceLimits({SHARPFORGE_TEST_CONCURRENCY: 'many'}, 16 * GIB).testConcurrency, 2);
});

test('resource limits: node --test arguments get a concurrency cap unless one is given', () => {
  const limits = {testConcurrency: 2, parallelRuns: 2, maxOldSpaceMb: 2048};
  assert.deepEqual(limitTestArgs(['--test', 'a.test.js'], limits), ['--test', '--test-concurrency=2', 'a.test.js']);
  assert.deepEqual(limitTestArgs(['--test', '--test-concurrency=8', 'a.test.js'], limits), ['--test', '--test-concurrency=8', 'a.test.js']);
  assert.deepEqual(limitTestArgs(['script.js'], limits), ['script.js']);
  assert.deepEqual(limitTestArgs(['--test', 'a.test.js'], {...limits, testConcurrency: null}), ['--test', 'a.test.js']);
});

test('resource limits: heap cap is appended to NODE_OPTIONS and never overrides an explicit cap', () => {
  const limits = {testConcurrency: 2, parallelRuns: 2, maxOldSpaceMb: 2048};
  assert.equal(limitedEnv({}, limits).NODE_OPTIONS, '--max-old-space-size=2048');
  assert.equal(limitedEnv({NODE_OPTIONS: '--enable-source-maps'}, limits).NODE_OPTIONS, '--enable-source-maps --max-old-space-size=2048');
  assert.equal(limitedEnv({NODE_OPTIONS: '--max-old-space-size=512'}, limits).NODE_OPTIONS, '--max-old-space-size=512');
  assert.equal(limitedEnv({}, {...limits, maxOldSpaceMb: null}).NODE_OPTIONS, undefined);
});

test('resource limits: run slots are counted, released and reject unsafe legacy stale recovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-slots-'));
  try {
    const limits = {testConcurrency: 1, parallelRuns: 2, maxOldSpaceMb: null};
    const first = await acquireRunSlot({env: {}, limits, directory, log: () => {}});
    const second = await acquireRunSlot({env: {}, limits, directory, log: () => {}});
    assert.equal(readdirSync(directory).length, 2);
    let waited = false;
    const third = acquireRunSlot({env: {}, limits, directory, pollMs: 10, log: () => { waited = true; }});
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(waited, true);
    first();
    const releaseThird = await third;
    assert.equal(readdirSync(directory).length, 2);
    second(); releaseThird();
    assert.equal(readdirSync(directory).length, 0);
    // Old wrappers do not participate in inode-bound cleanup elections; legacy recovery is explicit.
    writeFileSync(join(directory, 'slot-0.lock'), '999999999');
    writeFileSync(join(directory, 'slot-1.lock'), '999999998');
    await assert.rejects(acquireRunSlot({env: {}, limits, directory, log: () => {}}), {code: 'RUN_SLOT_LEGACY_STALE'});
    rmSync(join(directory, 'slot-0.lock'));
    rmSync(join(directory, 'slot-1.lock'));
    const reclaimed = await acquireRunSlot({env: {}, limits, directory, log: () => {}});
    reclaimed();
    assert.equal((await acquireRunSlot({limits: {...limits, parallelRuns: null}, directory}))(), undefined);
  } finally {
    rmSync(directory, {recursive: true, force: true});
    rmSync(directory + '.leases', {recursive: true, force: true});
  }
});
