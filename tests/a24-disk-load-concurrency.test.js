import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
import {FileSystemError, hashFileBytes} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = text => new TextEncoder().encode(text);

async function workspace(options = {}) {
  const provider = new DelayedProvider();
  const records = [];
  for (const [path, text] of [['A.cs', 'first'], ['Other.cs', 'other']]) {
    await provider.writeFile(path, bytes(text));
    records.push({path, size: bytes(text).length, lazy: true});
  }
  const disk = new DiskWorkspace(records, new Map(), 'Concurrency', [], [], {provider, ...options});
  return {disk, provider};
}

function snapshot(disk) {
  return {
    records: disk.records.map(record => ({...record})),
    index: [...disk.index].map(([path, record]) => [path, {...record}]),
    positions: [...disk.positions],
    baselines: [...disk.baselineHashes],
    handles: [...disk.handles],
    loadedBytes: disk.loadedBytes
  };
}

const mutations = {
  delete: disk => disk.delete('A.cs'),
  rename: disk => disk.rename('A.cs', 'Renamed.cs'),
  'rename away and back': async disk => {
    await disk.rename('A.cs', 'Renamed.cs');
    await disk.rename('Renamed.cs', 'A.cs');
  },
  refresh: disk => disk.adoptRecords(disk.records),
  replacement: async (disk, provider) => {
    const original = await provider.stat('A.cs');
    await disk.save([{path: 'A.cs', text: 'replacement', expectedHash: original.hash}]);
  },
  'newer load': async (disk, provider) => {
    await provider.writeFile('A.cs', bytes('newer'));
    await disk.load('A.cs');
  }
};

for (const phase of ['read', 'handle']) {
  for (const [name, mutate] of Object.entries(mutations)) {
    test('A24 delayed ' + phase + ' rejects concurrent ' + name + ' without publishing stale disk state', async () => {
      const {disk, provider} = await workspace();
      const gate = provider.pause(phase);
      const pending = disk.load('a.CS');
      const rejected = assert.rejects(pending, error => error.code === 'Conflict' && error.path === 'A.cs');
      await gate.entered;
      await mutate(disk, provider);
      const expected = snapshot(disk);
      gate.release();
      await rejected;
      assert.deepEqual(snapshot(disk), expected);
      assert(!disk.record('A.cs') || disk.record('A.cs').text !== 'first');
    });
  }
}

test('A24 a load publishes bytes, hash and acquired handle together using the canonical path', async () => {
  const {disk, provider} = await workspace();
  const gate = provider.pause('handle');
  const before = snapshot(disk);
  const pending = disk.load('a.CS');
  await gate.entered;
  assert.deepEqual(snapshot(disk), before);
  gate.release();
  const record = await pending;
  assert.equal(record.path, 'A.cs');
  assert.equal(record.text, 'first');
  assert.equal(record.lazy, false);
  assert.equal(disk.record('a.cs'), record);
  assert.equal(disk.handles.get('A.cs'), provider.find('A.cs'));
  assert.equal(disk.baselineHashes.get('A.cs'), await hashFileBytes(bytes('first')));
  assert.equal(disk.loadedBytes, 5);
  assert.equal(await disk.load('A.cs'), record);
  assert.equal(provider.reads, 1);
});

test('A24 changes to another entry do not invalidate a pending load', async () => {
  const {disk, provider} = await workspace();
  const gate = provider.pause('handle');
  const pending = disk.load('A.cs');
  await gate.entered;
  await disk.load('Other.cs');
  await disk.rename('Other.cs', 'Unrelated.cs');
  await disk.save([{path: 'Unrelated.cs', text: 'changed'}]);
  gate.release();
  assert.equal((await pending).text, 'first');
  assert.equal(disk.record('Unrelated.cs').text, 'changed');
  assert.equal(disk.loadedBytes, 12);
});

test('A24 a changed baseline without record replacement invalidates a pending load', async () => {
  const {disk, provider} = await workspace();
  const gate = provider.pause('handle');
  const pending = disk.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'Conflict');
  await gate.entered;
  disk.baselineHashes.set('A.cs', await hashFileBytes(bytes('changed')));
  const expected = snapshot(disk);
  gate.release();
  await rejected;
  assert.deepEqual(snapshot(disk), expected);
});

test('A24 failed file-handle acquisition preserves existing record, baseline and handle on reload', async () => {
  const {disk, provider} = await workspace();
  await disk.load('A.cs');
  await provider.writeFile('A.cs', bytes('external'));
  const before = snapshot(disk);
  const gate = provider.pause('handle');
  const pending = disk.load('A.cs', {reload: true});
  const rejected = assert.rejects(pending, error => error.code === 'NoPermissions');
  await gate.entered;
  assert.deepEqual(snapshot(disk), before);
  gate.reject(new FileSystemError('NoPermissions', 'A.cs'));
  await rejected;
  assert.deepEqual(snapshot(disk), before);
});

for (const phase of ['read', 'handle']) {
  test('A24 cancellation during ' + phase + ' acquisition leaves disk state unchanged', async () => {
    const {disk, provider} = await workspace();
    const controller = new AbortController();
    const gate = provider.pause(phase);
    const before = snapshot(disk);
    const pending = disk.load('A.cs', {signal: controller.signal});
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await gate.entered;
    controller.abort();
    gate.release();
    await rejected;
    assert.deepEqual(snapshot(disk), before);
    if (phase === 'read') assert.equal(provider.handleReads, 0);
  });
}

test('A24 already-cancelled loading does not perform provider I/O', async () => {
  const {disk, provider} = await workspace();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(disk.load('A.cs', {signal: controller.signal}), error => error.name === 'AbortError');
  assert.equal(provider.reads, 0);
  assert.equal(provider.handleReads, 0);
  assert.equal(disk.loadedBytes, 0);
});

test('A24 admission rechecks the byte budget after asynchronous handle acquisition', async () => {
  const {disk, provider} = await workspace({maxTotalBytes: 9});
  const gate = provider.pause('handle');
  const pending = disk.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'QuotaExceeded');
  await gate.entered;
  await disk.load('Other.cs');
  const expected = snapshot(disk);
  gate.release();
  await rejected;
  assert.deepEqual(snapshot(disk), expected);
});

test('A24 a refreshed catalog cannot be repopulated by an unindexed pending read', async () => {
  const {disk, provider} = await workspace();
  disk.adoptRecords([disk.record('Other.cs')]);
  const gate = provider.pause('read');
  const pending = disk.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'Conflict');
  await gate.entered;
  disk.adoptRecords(disk.records);
  const expected = snapshot(disk);
  gate.release();
  await rejected;
  assert.deepEqual(snapshot(disk), expected);
});
