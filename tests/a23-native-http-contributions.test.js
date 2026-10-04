import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { MSBuildClient } from '@sharpforge/msbuild';

test('A23 native HTTP service contributions preserve requests, diagnostics and disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-contributions-'));
  let disposed = false;
  const host = await startMSBuildHost({ root, port: 0, nativeServices: { contributions: [registry => {
    registry.register('example', 'echo', (request, { signal }) => ({ request, cancellable: !!signal }));
    registry.register('example', 'fail', () => {
      throw Object.assign(new Error('Located failure'), { diagnostics: [{ code: 'SF0001', path: 'a.cs',
        severity: 'error', message: 'diagnostic', start: 2, length: 1, line: 1, column: 3 }] });
    });
    registry.disposables.push({ close() { disposed = true; } });
  }] } });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    assert.deepEqual(await client.service('example', 'echo', { value: 'kept' }), { request: { value: 'kept' }, cancellable: true });
    await assert.rejects(client.service('example', 'missing', {}), error => error.status === 404);
    await assert.rejects(client.service('example', 'fail', {}), error => {
      assert.equal(error.diagnostics[0].code, 'SF0001');
      assert.equal(error.diagnostics[0].start, 2);
      assert.equal(error.diagnostics[0].path, 'a.cs');
      return true;
    });
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
  assert.equal(disposed, true);
});

test('A23 VFS service contribution cannot bypass the native workspace write guard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-vfs-guard-'));
  const host = await startMSBuildHost({ root, port: 0 });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    host.engine.startingCount++;
    try {
      await assert.rejects(client.service('vfs', 'request', { method: 'createDirectory', payload: { path: 'blocked' } }),
        error => error.status === 409 && error.code === 'Conflict' && error.path === 'blocked');
    } finally { host.engine.startingCount--; }
    await assert.rejects(client.vfs('stat', { path: 'blocked' }), error => error.code === 'NotFound');
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('A23 native text reads honor admitted publish and custom project extensions through the shared codec', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-text-types-'));
  const host = await startMSBuildHost({ root, port: 0 });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    for (const name of ['Folder.pubxml', 'Native.vcxproj']) {
      const text = '<Project>\r\n</Project>';
      await writeFile(join(root, name), Buffer.from(text, 'utf16le'));
      const record = await client.read(name);
      assert.equal(record.text, text);
      assert.equal(record.encoding, 'utf-16le');
      assert.equal(record.bom, false);
    }
    await writeFile(join(root, 'binary.pubxml'), Uint8Array.of(1, 2, 3, 4));
    await assert.rejects(client.read('binary.pubxml'), /Binary files are not editable text/);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
