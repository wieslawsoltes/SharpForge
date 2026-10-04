import test from 'node:test';
import assert from 'node:assert/strict';
import {FileSystemAccessProvider} from '@sharpforge/workspace';
import {TestDirectoryHandle} from './support/a24-fsa.js';
import {assertProviderConformance} from './support/a24-provider-conformance.js';

const bytes = value => new TextEncoder().encode(value);

test('A24 File System Access mock satisfies the complete provider contract', async () => {
  await assertProviderConformance(new FileSystemAccessProvider(new TestDirectoryHandle()));
});

test('A24 FSA permissions and atomic writable failure preserve original bytes', async () => {
  const root = new TestDirectoryHandle();
  const handle = await root.put('a.txt', 'original', {failWrite: true});
  const provider = new FileSystemAccessProvider(root);
  await assert.rejects(provider.writeFile('a.txt', bytes('changed')), error => error.code === 'QuotaExceeded');
  assert.equal(new TextDecoder().decode(handle.bytes), 'original');
  handle.options.permission = 'denied';
  await assert.rejects(provider.readFile('a.txt'), error => error.code === 'NoPermissions');
  assert.equal(handle.writes, 0);
  provider.dispose();
});

test('A24 FSA fallback directory rename rolls back when external files appear during copying', async () => {
  const root = new TestDirectoryHandle();
  await root.put('src/a.txt', 'original');
  const provider = new FileSystemAccessProvider(root);
  const subscribe = provider.events.subscribe('', event => {
    if (event.path === 'target/a.txt' && event.type === 'created') {
      root.children.get('src').children.set('external.txt', {kind: 'file', name: 'external.txt',
        getFile: async () => new File(['external'], 'external.txt')});
    }
  });
  await assert.rejects(provider.rename('src', 'target'), error => error.code === 'Conflict');
  assert(root.children.get('src').children.has('external.txt'));
  assert(root.children.get('src').children.has('a.txt'));
  assert(!root.children.has('target'));
  subscribe.dispose();
});
