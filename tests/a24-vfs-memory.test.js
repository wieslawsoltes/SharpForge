import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, FileSystemProvider, Workspace} from '@sharpforge/workspace';
import {assertProviderConformance} from './support/a24-provider-conformance.js';

const bytes = value => new TextEncoder().encode(value);

test('A24 in-memory provider satisfies the complete byte-oriented provider contract', async () => {
  await assertProviderConformance(new MemoryFileSystemProvider());
});

test('A24 memory identity and bounded writes preserve contents on conflict and quota failure', async () => {
  const provider = new MemoryFileSystemProvider({caseSensitive: false, maxBytes: 4});
  await provider.writeFile('Program.CS', bytes('old'));
  assert.equal(new TextDecoder().decode(await provider.readFile('program.cs')), 'old');
  await assert.rejects(provider.writeFile('program.cs', bytes('longer')), error => error.code === 'QuotaExceeded');
  assert.equal(new TextDecoder().decode(await provider.readFile('Program.CS')), 'old');
  await provider.rename('program.cs', 'PROGRAM.cs');
  assert.equal((await provider.readDirectory(''))[0].name, 'PROGRAM.cs');
  const readonly = new MemoryFileSystemProvider({readonly: true});
  await assert.rejects(readonly.createDirectory('x'), error => error.code === 'ReadOnly');
  const bounded = new MemoryFileSystemProvider({maxEntries: 2});
  await assert.rejects(bounded.createDirectory('a/b', {recursive: true}), error => error.code === 'QuotaExceeded');
  assert.deepEqual(await bounded.readDirectory(''), []);
  provider.dispose();
  readonly.dispose();
  bounded.dispose();
});

test('A24 provider subscriptions stop on cancellation and unsupported operations are explicit', async () => {
  const provider = new MemoryFileSystemProvider();
  const controller = new AbortController();
  const events = [];
  await provider.watch('', event => events.push(event), {signal: controller.signal});
  await provider.writeFile('one.txt', bytes('one'));
  controller.abort();
  await provider.writeFile('two.txt', bytes('two'));
  assert.deepEqual(events.map(event => event.path), ['one.txt']);
  await assert.rejects(new FileSystemProvider().readFile('missing.txt'), error => error.code === 'Unavailable');
  provider.dispose();
});

test('A24 workspace facade retains the existing versioned document API', () => {
  const workspace = new Workspace();
  assert.equal(workspace.update('a.cs', 'class A {}', 1), true);
  assert.equal(workspace.update('a.cs', 'old', 1), false);
  const exported = workspace.exportProject();
  const restored = new Workspace();
  restored.importProject(exported);
  assert.equal(restored.documents.get('a.cs').source.text, 'class A {}');
});
