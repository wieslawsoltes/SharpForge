import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, sep} from 'node:path';
import {MemoryFileSystemProvider, FileSystemAccessProvider, NativeHostFileSystemProvider, OriginPrivateFileSystemProvider,
  OverlayFileSystemProvider, hashFileBytes} from '@sharpforge/workspace';
import {createNativeVfsService} from '../packages/msbuild/src/native-vfs.js';
import {startMSBuildHost} from '../packages/msbuild/src/server.js';
import {MSBuildClient} from '../packages/msbuild/src/client.js';
import {TestDirectoryHandle} from './support/a24-fsa.js';

const bytes = value => new TextEncoder().encode(value);

async function nativeProvider() {
  const root = await mkdtemp(join(tmpdir(), 'sf-vfs-'));
  const workspace = {root, async path(value) {
    const output = resolve(root, value);
    const path = relative(root, output);
    if (path === '..' || path.startsWith('..' + sep)) throw new Error('Path escaped root');
    return output;
  }};
  const invoke = createNativeVfsService(workspace);
  const client = {async vfs(method, payload, options) { return structuredClone(await invoke(method, structuredClone(payload), options)); }};
  const provider = await NativeHostFileSystemProvider.connect(client);
  return {provider, dispose: async () => { provider.dispose(); await rm(root, {recursive: true, force: true}); }, root};
}

async function loopbackProvider() {
  const root = await mkdtemp(join(tmpdir(), 'sf-vfs-http-'));
  const host = await startMSBuildHost({root, port: 0});
  const client = new MSBuildClient({token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options)});
  const provider = await NativeHostFileSystemProvider.connect(client);
  return {provider, host, dispose: async () => { provider.dispose(); await host.close(); await rm(root, {recursive: true, force: true}); }};
}

const factories = [
  ['memory', async () => ({provider: new MemoryFileSystemProvider()})],
  ['FSA mock', async () => ({provider: new FileSystemAccessProvider(new TestDirectoryHandle())})],
  ['OPFS async mock', async () => ({provider: new OriginPrivateFileSystemProvider(new TestDirectoryHandle())})],
  ['native ' + process.platform + ' service', nativeProvider],
  ['native ' + process.platform + ' authenticated HTTP loopback', loopbackProvider]
];

for (const [name, factory] of factories) {
  test(`A24 provider conformance: ${name}`, async () => {
    const fixture = await factory();
    const provider = fixture.provider;
    try {
      assert.equal((await provider.stat('')).type, 'directory');
      await provider.createDirectory('src');
      assert.equal((await provider.stat('src')).type, 'directory');
      const original = Uint8Array.of(0, 255, 13, 10, 128, 1);
      const written = await provider.writeFile('src/opaque.bin', original, {expectedHash: null});
      assert.equal(written.hash, await hashFileBytes(original));
      original[0] = 10;
      assert.equal((await provider.readFile('src/opaque.bin'))[0], 0);
      const read = await provider.readFile('src/opaque.bin');
      read[1] = 0;
      assert.equal((await provider.readFile('src/opaque.bin'))[1], 255);
      assert.equal((await provider.readDirectory('src')).length, 1);
      await assert.rejects(provider.writeFile('src/opaque.bin', bytes('wrong'), {expectedHash: null}), error => error.code === 'Conflict');
      await assert.rejects(provider.writeFile('src/opaque.bin', bytes('wrong'), {overwrite: false}), error => error.code === 'AlreadyExists');
      await assert.rejects(provider.writeFile('missing.bin', bytes('x'), {create: false}), error => error.code === 'NotFound');
      await assert.rejects(provider.readFile('missing.bin'), error => error.code === 'NotFound');
      await assert.rejects(provider.delete('src'), error => error.code === 'DirectoryNotEmpty');
      await provider.rename('src/opaque.bin', 'src/moved.bin', {expectedHash: written.hash});
      await assert.rejects(provider.readFile('src/opaque.bin'), error => error.code === 'NotFound');
      assert.deepEqual(await provider.readFile('src/moved.bin'), Uint8Array.of(0, 255, 13, 10, 128, 1));
      await provider.writeFile('src/empty.txt', new Uint8Array());
      assert.equal((await provider.readFile('src/empty.txt')).length, 0);
      await provider.delete('src', {recursive: true});
      assert.equal((await provider.readDirectory('')).length, 0);
      for (const path of ['../outside', '/outside', 'C:\\outside', 'con.txt', 'a/../b']) {
        await assert.rejects(provider.writeFile(path, bytes('x')), error => error.code === 'InvalidPath');
      }
      const controller = new AbortController();
      controller.abort();
      for (const action of [() => provider.stat('', {signal: controller.signal}),
        () => provider.writeFile('cancelled.txt', bytes('x'), {signal: controller.signal}),
        () => provider.createDirectory('cancelled', {signal: controller.signal})]) {
        await assert.rejects(action, error => error.name === 'AbortError');
      }
      provider.dispose();
      await assert.rejects(provider.stat(''), error => error.code === 'Disposed');
    } finally { await fixture.dispose?.(); provider.dispose(); }
  });
}

test('A24 memory identity and bounded writes preserve contents on conflict/quota failure', async () => {
  const provider = new MemoryFileSystemProvider({caseSensitive: false, maxBytes: 4});
  await provider.writeFile('Program.CS', bytes('old'));
  assert.equal(new TextDecoder().decode(await provider.readFile('program.cs')), 'old');
  await assert.rejects(provider.writeFile('program.cs', bytes('longer')), error => error.code === 'QuotaExceeded');
  assert.equal(new TextDecoder().decode(await provider.readFile('Program.CS')), 'old');
  await provider.rename('program.cs', 'PROGRAM.cs');
  assert.equal((await provider.readDirectory(''))[0].name, 'PROGRAM.cs');
  const readonly = new MemoryFileSystemProvider({readonly: true});
  await assert.rejects(readonly.createDirectory('x'), error => error.code === 'ReadOnly');
});

test('A24 native HTTP conflicts retain provider codes and paths and guard directory creation during builds', async () => {
  const fixture = await loopbackProvider();
  try {
    const {provider, host} = fixture;
    await provider.createDirectory('src');
    await provider.writeFile('src/a.cs', bytes('initial'));
    await assert.rejects(provider.delete('src'), error => error.code === 'DirectoryNotEmpty' && error.path === 'src');
    await assert.rejects(provider.writeFile('src/a.cs', bytes('changed'), {expectedHash: null}),
      error => error.code === 'Conflict' && error.path === 'src/a.cs');
    host.engine.startingCount++;
    try {
      await assert.rejects(provider.createDirectory('blocked'), error => error.code === 'Conflict' && error.path === 'blocked');
      await assert.rejects(provider.writeFile('src/a.cs', bytes('blocked')), error => error.code === 'Conflict' && error.path === 'src/a.cs');
      assert.equal(new TextDecoder().decode(await provider.readFile('src/a.cs')), 'initial');
    } finally { host.engine.startingCount--; }
    await assert.rejects(provider.stat('blocked'), error => error.code === 'NotFound');
  } finally { await fixture.dispose(); }
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

test('A24 overlay keeps dirty buffers consistent and generated URIs read-only', async () => {
  const base = new MemoryFileSystemProvider();
  await base.writeFile('a.cs', bytes('old'));
  const overlay = new OverlayFileSystemProvider(base);
  await overlay.setBuffer('a.cs', 'dirty');
  assert.equal(new TextDecoder().decode(await overlay.readFile('a.cs')), 'dirty');
  assert.equal(new TextDecoder().decode(await base.readFile('a.cs')), 'old');
  await overlay.save('a.cs');
  assert.equal(new TextDecoder().decode(await base.readFile('a.cs')), 'dirty');
  await overlay.setBuffer('a.cs', 'user text');
  await base.writeFile('a.cs', bytes('external'));
  await assert.rejects(overlay.save('a.cs'), error => error.code === 'Conflict');
  assert.equal(new TextDecoder().decode(await overlay.readFile('a.cs')), 'user text');
  await overlay.setGenerated('generated://source/a.cs', 'generated');
  assert.equal(new TextDecoder().decode(await overlay.readFile('generated://source/a.cs')), 'generated');
  await assert.rejects(overlay.writeFile('generated://source/a.cs', bytes('x')), error => error.code === 'ReadOnly');
  await overlay.writeFile('new.cs', bytes('new'));
  assert((await overlay.readDirectory('')).some(entry => entry.name === 'new.cs'));
  await overlay.save('new.cs');
  assert.equal(new TextDecoder().decode(await base.readFile('new.cs')), 'new');
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
