import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

