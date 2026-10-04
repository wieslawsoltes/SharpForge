import test from 'node:test';
import assert from 'node:assert/strict';
import {DiskWorkspace, ProviderDiskWorkspace, readDirectory, readProviderDirectory} from '@sharpforge/project-system';
import {TestDirectoryHandle} from './support/a24-fsa.js';

test('legacy directory callers retain explicit existing-file saves while provider callers opt into new-file writes', async () => {
  const root = new TestDirectoryHandle();
  await root.put('A.cs', 'original');
  const legacy = await readDirectory(root);
  assert(legacy instanceof DiskWorkspace);
  assert(!(legacy instanceof ProviderDiskWorkspace));
  await legacy.save([{path: 'A.cs', text: 'legacy save'}]);
  await assert.rejects(legacy.save([{path: 'New.cs', text: 'new source'}]), /No write handle/);
  const provider = await readProviderDirectory(root);
  assert(provider instanceof ProviderDiskWorkspace);
  assert(!(provider instanceof DiskWorkspace));
  await provider.create('New.cs', 'new source');
  assert.equal(new TextDecoder().decode(root.children.get('New.cs').bytes), 'new source');
});

test('only the explicit provider directory factory uses metadata-first loading for a large inventory', async () => {
  const root = new TestDirectoryHandle();
  for (let index = 0; index < 260; index++) await root.put(`F${index}.cs`, 'class C{}');
  const provider = await readProviderDirectory(root);
  assert.equal(provider.records.filter(record => record.lazy).length, 260);
  assert.equal([...root.children.values()].reduce((count, file) => count + file.reads, 0), 0);
  const legacy = await readDirectory(root);
  assert.equal(legacy.records.filter(record => typeof record.text === 'string').length, 260);
  assert.equal([...root.children.values()].reduce((count, file) => count + file.reads, 0), 260);
});
