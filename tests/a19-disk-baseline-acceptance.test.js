import test from 'node:test';
import assert from 'node:assert/strict';
import {DiskWorkspace} from '@sharpforge/project-system';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {sourceFileHandle} from './fixtures/a20-source-file-fixture.js';
import {deferred, observationLimits} from './fixtures/a19-disk-observation.js';

async function context(test, text = 'old') {
  const handle = sourceFileHandle('A.cs', text);
  const record = await readStudioSource(await handle.getFile(), {path: 'A.cs', limits: observationLimits});
  const disk = new DiskWorkspace([record], new Map([['A.cs', handle]]), 'Files', [], [], {
    ...observationLimits, readSource: readStudioSource
  });
  test.after(() => record.model.dispose());
  return {disk, handle};
}

const observation = text => ({text, encoding: 'utf-8', bom: false, byteLength: text.length});
const acceptOptions = (disk, handle) => ({expectedHandle: handle, expectedVersion: disk.getVersion('A.cs')});

test('A19 accepting an external baseline updates byte budget and disk version so a later save succeeds', async t => {
  const {disk, handle} = await context(t);
  handle.setExternal('external');
  const options = acceptOptions(disk, handle);
  const events = [];
  const result = await disk.acceptBaseline('A.cs', observation('external'), {...options, commit(accept) {
    events.push('document');
    const committed = accept();
    assert.equal(disk.getVersion('A.cs'), committed.version);
    events.push('notifications');
  }});
  assert.deepEqual(result, {path: 'A.cs', version: options.expectedVersion + 1, byteLength: 8});
  assert.deepEqual(events, ['document', 'notifications']);
  assert.equal(disk.sizes.get('A.cs'), 8);
  await disk.save([{path: 'A.cs', text: 'next', expectedVersion: result.version}]);
  assert.equal(new TextDecoder().decode(handle.bytes), 'next');
  assert.equal(handle.metrics.written, 1);
});

test('A19 an old observation cannot bypass changed bytes, changed handles, or saved versions', async t => {
  const {disk, handle} = await context(t);
  const options = acceptOptions(disk, handle);
  handle.setExternal('new');
  await assert.rejects(disk.acceptBaseline('A.cs', observation('bad'), options), {code: 'SFPROJECT_DISK_OBSERVATION_STALE'});
  await assert.rejects(disk.acceptBaseline('A.cs', observation('new'), {...options, expectedHandle: {}}), {
    code: 'SFPROJECT_DISK_OBSERVATION_STALE'
  });
  await assert.rejects(disk.acceptBaseline('A.cs', observation('new'), {...options, expectedVersion: 99}), {
    code: 'SFPROJECT_DISK_OBSERVATION_STALE'
  });
  assert.equal(disk.baseline.get('A.cs').getText(), 'old');
  assert.equal(disk.getVersion('A.cs'), options.expectedVersion);
  assert.equal(handle.metrics.opened, 0);
});

test('A19 baseline acceptance joins the save queue and refuses a revision committed ahead of it', async t => {
  const gate = deferred();
  const entered = deferred();
  const handle = sourceFileHandle('A.cs', 'old', {async permission() { entered.resolve(); await gate.promise; return 'granted'; }});
  const prepared = await readStudioSource(await handle.getFile(), {path: 'A.cs'});
  t.after(() => prepared.model.dispose());
  const disk = new DiskWorkspace([prepared], new Map([['A.cs', handle]]), 'Queued', [], [], {readSource: readStudioSource});
  const options = acceptOptions(disk, handle);
  const saving = disk.save([{path: 'A.cs', text: 'new'}]);
  await entered.promise;
  const accepting = disk.acceptBaseline('A.cs', observation('old'), options);
  gate.resolve();
  await saving;
  await assert.rejects(accepting, {code: 'SFPROJECT_DISK_OBSERVATION_STALE'});
  assert.equal(disk.baseline.get('A.cs'), 'new');
  assert.equal(handle.metrics.written, 1);
});

test('A19 cancellation and failed host preparation publish no baseline, while postcommit errors retain the accepted version', async t => {
  const {disk, handle} = await context(t);
  handle.setExternal('new');
  const options = acceptOptions(disk, handle);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(disk.acceptBaseline('A.cs', observation('new'), {...options, signal: controller.signal}), {name: 'AbortError'});
  await assert.rejects(disk.acceptBaseline('A.cs', observation('new'), {...options, commit() { throw new Error('host rejected'); }}), /host rejected/);
  assert.equal(disk.getVersion('A.cs'), options.expectedVersion);
  await assert.rejects(disk.acceptBaseline('A.cs', observation('new'), {...options, commit(accept) {
    accept();
    throw new Error('view failed');
  }}), error => error.committed === true && error.message === 'view failed');
  assert.equal(disk.baseline.get('A.cs'), 'new');
  assert.equal(disk.getVersion('A.cs'), options.expectedVersion + 1);
});

test('A19 observed encoded sizes and whole-workspace budgets are validated before host commit', async t => {
  const {disk, handle} = await context(t);
  handle.setExternal('new');
  let commits = 0;
  await assert.rejects(disk.acceptBaseline('A.cs', {...observation('new'), byteLength: 2}, {
    ...acceptOptions(disk, handle), commit() { commits++; }
  }), /byte length disagree/);
  const limited = new DiskWorkspace([{path: 'A.cs', text: 'old'}, {path: 'B.cs', text: 'x'.repeat(5)}],
    new Map([['A.cs', handle]]), 'Limited', [], [], {maxFileBytes: 10, maxTotalBytes: 8, readSource: readStudioSource});
  handle.setExternal('longer');
  await assert.rejects(limited.acceptBaseline('A.cs', observation('longer'), {
    ...acceptOptions(limited, handle), commit() { commits++; }
  }), /total byte limit/);
  assert.equal(commits, 0);
});

test('A19 a rebased DiskWorkspace accepts only its mapped path and keeps the original queue and baseline independent', async t => {
  const {disk, handle} = await context(t);
  const replacement = {path: 'Folder/A.cs', text: 'old', encoding: 'utf-8', bom: false};
  const rebased = disk.rebasePaths(new Map([['A.cs', replacement.path]]), [replacement]);
  handle.setExternal('new');
  await rebased.acceptBaseline(replacement.path, observation('new'), {
    expectedHandle: handle, expectedVersion: rebased.getVersion(replacement.path)
  });
  assert.equal(rebased.baseline.get(replacement.path), 'new');
  assert.equal(disk.baseline.get('A.cs').getText(), 'old');
  await rebased.save([{path: replacement.path, text: 'after'}]);
  assert.equal(new TextDecoder().decode(handle.bytes), 'after');
  await assert.rejects(disk.save([{path: 'A.cs', text: 'stale'}]), /Disk conflict/);
});
