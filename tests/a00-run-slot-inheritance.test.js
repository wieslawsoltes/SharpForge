import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireRunSlot} from '../scripts/planning/lib/resource-limits.js';
import {runSlotEnvironmentKey} from '../scripts/planning/lib/run-slot-lease.js';
import {currentRunSlotOwner, runSlotOwnerAlive} from '../scripts/planning/lib/run-slot-owner.js';

const moduleURL = new URL('../scripts/planning/lib/resource-limits.js', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url));
const limits = {parallelRuns: 1, testConcurrency: 1, maxOldSpaceMb: 512};
const childEnvironment = extra => ({...process.env, NODE_TEST_CONTEXT: undefined, [runSlotEnvironmentKey]: undefined, ...extra});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-slot-inheritance-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  return {directory, slots: join(directory, 'slots')};
}

function child(source, env) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source],
    {encoding: 'utf8', timeout: 5000, env: childEnvironment(env)});
}

function startChild(source, env) {
  const process_ = spawn(process.execPath, ['--input-type=module', '--eval', source],
    {stdio: ['ignore', 'pipe', 'pipe'], env: childEnvironment(env)});
  const state = {process: process_, output: '', error: ''};
  process_.stdout.on('data', value => { state.output += value; });
  process_.stderr.on('data', value => { state.error += value; });
  state.done = new Promise((resolve, reject) => {
    process_.once('error', reject);
    process_.once('exit', (code, signal) => resolve({code, signal}));
  });
  return state;
}

async function waitFor(state, text) {
  for (let index = 0; index < 300 && !state.output.includes(text); index++) await delay(10);
  assert(state.output.includes(text), 'Child did not reach ' + text + ': ' + state.error);
}

const acquireSource = slots => `import {acquireRunSlot} from ${JSON.stringify(moduleURL)};
  const release = await acquireRunSlot({directory:${JSON.stringify(slots)}, limits:${JSON.stringify(limits)},
    pollMs:10, log:()=>console.log('WAITING')});`;

test('run-slot child reuses an exact live lease without releasing its owner', async t => {
  const {slots} = fixture(t);
  const release = await acquireRunSlot({directory: slots, limits, env: {}});
  try {
    const result = child(acquireSource(slots) + `release(); console.log('BORROWED');`, release.environment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'BORROWED');
    assert.deepEqual(readdirSync(slots), ['slot-0.lock']);
  } finally { release(); }
  assert.deepEqual(readdirSync(slots), []);
  assert.deepEqual(readdirSync(slots + '.leases'), []);
});

test('run-slot invalid, altered, expired and foreign-directory capabilities fail closed', async t => {
  const {directory, slots} = fixture(t);
  const release = await acquireRunSlot({directory: slots, limits, env: {}});
  const lease = JSON.parse(release.environment[runSlotEnvironmentKey]);
  const invalid = ['not-json', '{}', JSON.stringify({...lease, nonce: '0'.repeat(64)}),
    JSON.stringify({...lease, slot: 1}), JSON.stringify({...lease, file: {...lease.file, ino: '0'}})];
  try {
    for (const value of invalid) {
      await assert.rejects(acquireRunSlot({directory: slots, limits, env: {[runSlotEnvironmentKey]: value}}),
        {code: 'RUN_SLOT_LEASE_INVALID'});
    }
    await assert.rejects(acquireRunSlot({directory: join(directory, 'foreign'), limits, env: release.environment}),
      {code: 'RUN_SLOT_LEASE_INVALID'});
  } finally { release(); }
  await assert.rejects(acquireRunSlot({directory: slots, limits, env: release.environment}), {code: 'RUN_SLOT_LEASE_INVALID'});
});

test('run-slot release is idempotent and cannot delete a replacement inode or nonce', async t => {
  const {slots} = fixture(t);
  const first = await acquireRunSlot({directory: slots, limits, env: {}});
  const path = join(slots, 'slot-0.lock');
  const saved = JSON.parse(first.environment[runSlotEnvironmentKey]);
  rmSync(path);
  const second = await acquireRunSlot({directory: slots, limits, env: {}});
  try {
    const replacement = JSON.parse(second.environment[runSlotEnvironmentKey]);
    assert.notEqual(replacement.nonce, saved.nonce);
    first(); first();
    assert(existsSync(path));
    const borrowed = await acquireRunSlot({directory: slots, limits, env: second.environment});
    borrowed();
    assert(existsSync(path));
  } finally { second(); first(); }
});

test('run-slot independent contender waits until the original owner releases', async t => {
  const {slots} = fixture(t);
  const release = await acquireRunSlot({directory: slots, limits, env: {}});
  const contender = startChild(acquireSource(slots) + `console.log('ACQUIRED'); release();`);
  try {
    await waitFor(contender, 'WAITING');
    assert(!contender.output.includes('ACQUIRED'));
    release();
    assert.equal((await contender.done).code, 0, contender.error);
    assert(contender.output.includes('ACQUIRED'));
    assert.deepEqual(readdirSync(slots), []);
  } finally { release(); contender.process.kill(); }
});

test('run-slot normal owner exit releases its lease and abrupt exit is metadata-reclaimed', async t => {
  const {slots} = fixture(t);
  const normal = child(acquireSource(slots) + `console.log('EXIT');`);
  assert.equal(normal.status, 0, normal.stderr);
  assert.deepEqual(readdirSync(slots), []);
  const holder = startChild(acquireSource(slots) + `console.log('HELD'); setInterval(()=>{},1000);`);
  try {
    await waitFor(holder, 'HELD');
    holder.process.kill('SIGKILL');
    await holder.done;
    assert(existsSync(join(slots, 'slot-0.lock')));
    if (process.platform !== 'linux') {
      await assert.rejects(acquireRunSlot({directory: slots, limits, env: {}}), {code: 'RUN_SLOT_LEGACY_STALE'});
      return; // Old wrappers can race cleanup of an ordinary PID lock; only this private fixture is discarded.
    }
    const recovered = await acquireRunSlot({directory: slots, limits, env: {}});
    recovered();
    assert.deepEqual(readdirSync(slots), []);
    assert.deepEqual(readdirSync(slots + '.leases'), []);
  } finally { holder.process.kill(); }
});

test('run-slot Linux identity rejects PID reuse and boot changes while numeric locks remain legacy-readable', async t => {
  const {slots} = fixture(t);
  const release = await acquireRunSlot({directory: slots, limits, env: {}});
  try {
    const owner = currentRunSlotOwner();
    assert(runSlotOwnerAlive(owner));
    if (owner.kind === 'linux-proc') {
      assert.equal(runSlotOwnerAlive({...owner, start: String(BigInt(owner.start) + 1n)}), false);
      assert.equal(runSlotOwnerAlive({...owner, boot: '00000000-0000-0000-0000-000000000000'}), false);
    }
    // Run the previous wrapper's exact numeric/liveness rule over every file it would scan.
    for (const name of readdirSync(slots)) {
      const pid = Number(readFileSync(join(slots, name), 'utf8').trim() || 0);
      assert(pid > 0);
      let alive;
      try { process.kill(pid, 0); alive = true; } catch (error) { alive = error.code === 'EPERM'; }
      assert(alive, 'An old wrapper must not delete a live new-format lease');
    }
  } finally { release(); }
});

test('run-slot exact inherited metadata still rejects a Linux process-start mismatch', async t => {
  if (process.platform !== 'linux') return t.skip('Linux procfs owner identity is not used on this platform');
  const {slots} = fixture(t);
  const release = await acquireRunSlot({directory: slots, limits, env: {}});
  const original = release.environment[runSlotEnvironmentKey], lease = JSON.parse(original);
  const path = join(slots + '.leases', `slot-${lease.slot}-${lease.file.dev}-${lease.file.ino}.json`);
  try {
    lease.owner.start = String(BigInt(lease.owner.start) + 1n);
    const stale = JSON.stringify(lease);
    writeFileSync(path, stale);
    await assert.rejects(acquireRunSlot({directory: slots, limits, env: {[runSlotEnvironmentKey]: stale}}),
      {code: 'RUN_SLOT_LEASE_INVALID'});
    assert(existsSync(join(slots, 'slot-0.lock')), 'Rejected inheritance must not release another lease');
  } finally { writeFileSync(path, original); release(); }
});

test('run-slot wrapper to synchronous nested manifest runner completes with one serial slot', t => {
  const {directory} = fixture(t);
  const project = join(directory, 'project');
  mkdirSync(join(project, 'planning/contracts'), {recursive: true});
  mkdirSync(join(project, 'tests/manifests'), {recursive: true});
  writeFileSync(join(project, 'package.json'), JSON.stringify({type: 'module'}));
  writeFileSync(join(project, 'planning/catalog.json'), JSON.stringify({areas: [{id: 'A00'}]}));
  copyFileSync(join(root, 'planning/contracts/test-manifest.schema.json'), join(project, 'planning/contracts/test-manifest.schema.json'));
  writeFileSync(join(project, 'tests/manifests/A00.json'), JSON.stringify({schemaVersion: 1, area: 'A00',
    nodeGlobs: ['tests/one.test.js'], browserScripts: [], requiredServices: [], timeout: 10000, tags: []}));
  writeFileSync(join(project, 'tests/one.test.js'), `import test from 'node:test'; test('NESTED_RUN_COMPLETED',()=>{});`);
  const source = `import {spawnSync} from 'node:child_process';
    const result=spawnSync(process.execPath,[${JSON.stringify(join(root, 'scripts/planning/run-tests.js'))},
      '--root',${JSON.stringify(project)},'--area','A00'],{encoding:'utf8',timeout:5000,env:process.env});
    process.stdout.write(result.stdout??''); process.stderr.write(result.stderr??''); process.exit(result.status??1);`;
  const result = spawnSync(process.execPath, [join(root, 'scripts/limited.js'), process.execPath, '--input-type=module', '--eval', source],
    {encoding: 'utf8', timeout: 8000, env: childEnvironment({TMPDIR: directory, TMP: directory, TEMP: directory,
      SHARPFORGE_MAX_PARALLEL_RUNS: '1', SHARPFORGE_TEST_CONCURRENCY: '1', SHARPFORGE_MAX_OLD_SPACE_MB: '512'})});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NESTED_RUN_COMPLETED/);
  assert.doesNotMatch(result.stderr, /Waiting for a free run slot/);
  assert.deepEqual(readdirSync(join(directory, 'sharpforge-run-slots')), []);
});
