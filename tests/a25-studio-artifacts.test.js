import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtifactFilters } from '../apps/studio/services/artifacts.js';
import { downloadStudioArtifact } from '../apps/studio/services/downloads.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function downloadHost(artifacts) {
  const captured = { urls: [], clicked: [], revoked: [], errors: [], timers: [] };
  return { captured, artifacts,
    urls: { createObjectURL: blob => { captured.urls.push(blob); return 'blob:fixture'; },
      revokeObjectURL: url => captured.revoked.push(url) },
    document: { createElement: () => ({ click() { captured.clicked.push({ href: this.href, name: this.download }); } }) },
    schedule: action => captured.timers.push(action), onError: error => captured.errors.push(error) };
}

test('the actual download boundary waits for ordered artifact filters and emits only filtered bytes', async () => {
  const filters = createArtifactFilters();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  filters.register('redactor', async artifact => {
    await waiting;
    return { ...artifact, bytes: encoder.encode(decoder.decode(artifact.bytes).replaceAll('planted-token', '[REDACTED]')) };
  });
  filters.register('observer', artifact => {
    assert.equal(decoder.decode(artifact.bytes).includes('planted-token'), false);
    return artifact;
  });
  const host = downloadHost(filters);
  const result = downloadStudioArtifact(host, 'workspace.sharpforge.json', '{"file":"planted-token"}');
  assert.equal(host.captured.urls.length, 0);
  assert.equal(host.captured.clicked.length, 0);
  release();
  const saved = await result;
  assert.equal(saved.name, 'workspace.sharpforge.json');
  assert.equal(await host.captured.urls[0].text(), '{"file":"[REDACTED]"}');
  assert.deepEqual(host.captured.clicked, [{ href: 'blob:fixture', name: saved.name }]);
  host.captured.timers[0]();
  assert.deepEqual(host.captured.revoked, ['blob:fixture']);
});

test('failed, malformed, cancelled and disposed artifact filtering cannot create download URLs', async () => {
  for (const result of [() => { throw new Error('Secret-bearing binary'); }, () => null, () => ({ bytes: 'unsafe', mimeType: 'text/plain' })]) {
    const filters = createArtifactFilters();
    filters.register('reject', result);
    const host = downloadHost(filters);
    assert.equal(await downloadStudioArtifact(host, 'archive.zip', new Uint8Array([1, 2, 3]), 'application/zip'), null);
    assert.equal(host.captured.urls.length, 0);
    assert.equal(host.captured.errors.length, 1);
  }
  const filters = createArtifactFilters();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(filters.prepare({ name: 'cancelled', content: '', signal: controller.signal }), { name: 'AbortError' });
  filters.register('dispose', artifact => { filters.dispose(); return artifact; });
  const host = downloadHost(filters);
  assert.equal(await downloadStudioArtifact(host, 'disposed', ''), null);
  assert.equal(host.captured.urls.length, 0);
});

test('artifact subscriptions are isolated and binary views preserve their exact byte range', async () => {
  const filters = createArtifactFilters();
  const unregister = filters.register('one', () => { throw new Error('Removed filter must not run'); });
  assert.throws(() => filters.register('one', () => {}), /Duplicate/);
  unregister();
  const data = new Uint8Array([99, 1, 2, 3, 98]);
  const prepared = await filters.prepare({ name: 'image.bin', content: data.subarray(1, 4), mimeType: 'application/octet-stream' });
  assert.deepEqual(prepared.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(prepared.mimeType, 'application/octet-stream');
  const host = downloadHost(filters);
  const plain = await downloadStudioArtifact(host, 'diagnostics.txt', 'Ordinary diagnostic text');
  assert.equal(plain.mimeType, 'text/plain');
  assert.equal(await host.captured.urls[0].text(), 'Ordinary diagnostic text');
});
