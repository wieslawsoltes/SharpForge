import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
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
