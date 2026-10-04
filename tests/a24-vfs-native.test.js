import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeHostFileSystemProvider } from '@sharpforge/workspace';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { MSBuildClient } from '@sharpforge/msbuild';
import { assertProviderConformance } from './support/a24-provider-conformance.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-vfs-http-'));
  const host = await startMSBuildHost({ root, port: 0 });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  const provider = await NativeHostFileSystemProvider.connect(client);
  return { host, client, provider, async dispose() {
    provider.dispose();
    await host.close();
    await rm(root, { recursive: true, force: true });
  } };
}

test('A24 native provider conformance through authenticated HTTP loopback', async () => {
  const current = await fixture();
  try { await assertProviderConformance(current.provider); }
  finally { await current.dispose(); }
});

test('A24 native HTTP retains conflict paths, guards builds and preserves raw binary files', async () => {
  const current = await fixture();
  try {
    const { host, client, provider } = current;
    const bytes = Uint8Array.of(0, 255, 13, 10, 128, 1);
    await provider.createDirectory('src');
    await provider.writeFile('src/opaque.bin', bytes);
    assert.deepEqual(await client.binary('src/opaque.bin'), bytes);
    await assert.rejects(provider.delete('src'), error => error.code === 'DirectoryNotEmpty' && error.path === 'src');
    await assert.rejects(provider.writeFile('src/opaque.bin', bytes, { expectedHash: null }),
      error => error.code === 'Conflict' && error.path === 'src/opaque.bin');
    host.engine.startingCount++;
    try {
      await assert.rejects(provider.createDirectory('blocked'), error => error.code === 'Conflict' && error.path === 'blocked');
      await assert.rejects(provider.writeFile('src/opaque.bin', Uint8Array.of(1)),
        error => error.code === 'Conflict' && error.path === 'src/opaque.bin');
      assert.deepEqual(await provider.readFile('src/opaque.bin'), bytes);
    } finally { host.engine.startingCount--; }
    await assert.rejects(provider.stat('blocked'), error => error.code === 'NotFound');
  } finally { await current.dispose(); }
});
