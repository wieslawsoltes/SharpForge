import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const encode = value => new TextEncoder().encode(value);

test('disk admission callbacks are synchronous and a rejected callback cannot publish bytes, hashes or handles', async () => {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', encode('class A {}'));
  const disk = new DiskWorkspace([{path: 'A.cs', size: 10, version: 9, lazy: true}], new Map(), 'Guard', [], [], {provider});
  await assert.rejects(disk.load('A.cs', {beforeAdmit() { throw new Error('stale editor'); }}), /stale editor/);
  assert.equal(disk.record('A.cs').lazy, true);
  assert.equal(disk.loadedBytes, 0);
  assert.equal(disk.baselineHashes.size, 0);
  assert.equal(disk.handles.size, 0);
  await assert.rejects(disk.load('A.cs', {beforeAdmit: async () => {}}), /synchronous/);
  await assert.rejects(disk.load('A.cs', {beforeAdmit: () => Promise.reject(new Error('invalid async guard'))}), /synchronous/);
  const record = await disk.load('A.cs');
  assert.equal(record.version, 10);
  disk.unload('A.cs');
  assert.deepEqual(Object.keys(disk.record('A.cs')).toSorted(), ['lazy', 'path', 'size', 'version']);
  assert.equal((await disk.load('A.cs')).version, 11);
});
