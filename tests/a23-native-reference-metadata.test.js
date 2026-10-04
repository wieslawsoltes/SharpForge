import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeNativeMetadata} from '../apps/studio/native-build/metadata.js';

test('native metadata validates identity, count, byte budgets, encoding, size and SHA-256', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const reference = {path: '/sdk/Contract.dll', base64: 'AQID', size: 3, sha256: createHash('sha256').update(bytes).digest('hex')};
  const report = {contextId: 'context', references: [reference], totalBytes: 3};
  assert.deepEqual((await decodeNativeMetadata(report, 'context'))[0].bytes, bytes);
  await assert.rejects(decodeNativeMetadata(report, 'other'), /different project context/);
  await assert.rejects(decodeNativeMetadata({...report, references: Array(513).fill(reference)}, 'context'), /count/);
  await assert.rejects(decodeNativeMetadata(report, 'context', {maxBytes: 2}), /byte limit/);
  await assert.rejects(decodeNativeMetadata({...report, references: [{...reference, base64: '!!!!'}]}, 'context'), /encoding/);
  await assert.rejects(decodeNativeMetadata({...report, references: [{...reference, sha256: 'a'.repeat(64)}]}, 'context'), /hash mismatch/);
  await assert.rejects(decodeNativeMetadata({...report, totalBytes: 4}, 'context'), /aggregate/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decodeNativeMetadata(report, 'context', {signal: controller.signal}), error => error.name === 'AbortError');
});
