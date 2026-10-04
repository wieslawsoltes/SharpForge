import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { GitError } from '../packages/git/src/errors.js';
import { readPack } from '../packages/git/src/pack/reader.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { encodeObjectHeader, writeUint32 } from '../packages/git/src/pack/binary.js';
import { concatBytes } from '../packages/git/src/protocol/bytes.js';
import { deflateZlib } from '../packages/git/src/zlib.js';
import { HttpGitTransport } from '../packages/git/src/transport/http.js';

async function pendingDeltaThenInvalidEntry() {
  const header = new Uint8Array(12);
  header.set([80, 65, 67, 75]);
  writeUint32(header, 4, 2);
  writeUint32(header, 8, 2);
  const delta = Uint8Array.of(1, 1, 1, 65);
  return concatBytes([
    header, encodeObjectHeader(7, delta.length), new Uint8Array(20).fill(1), await deflateZlib(delta),
    new Uint8Array(128)
  ]);
}

function failingStaging(failure) {
  const state = { stored: [], deleted: [] };
  return {
    state,
    async set(key) { state.stored.push(key); },
    async delete(key) {
      state.deleted.push(key);
      throw failure;
    }
  };
}

test('a staging cleanup failure still cancels the real response stream and clears its HTTP deadline', async t => {
  const bytes = await pendingDeltaThenInvalidEntry();
  const cleanupFailure = new GitError('Quota', 'Staging cleanup failed');
  const staging = failingStaging(cleanupFailure);
  const controller = new AbortController();
  let cancellations = 0;
  let fetchSignal;
  const body = new ReadableStream({
    start(stream) { stream.enqueue(bytes); },
    cancel() { cancellations++; }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = new HttpGitTransport({
    origins: ['https://git.test'], timeoutMs: 30 * 60_000,
    fetch: async (_, request) => {
      fetchSignal = request.signal;
      return new Response(body);
    }
  });
  const response = await transport.request({ url: 'https://git.test/repository.git', signal: controller.signal });
  await assert.rejects(readPack(response.body, { staging, signal: controller.signal }), error => {
    assert.equal(error.code, 'Corrupt');
    assert.equal(error.message, 'Invalid pack object type');
    assert.equal(error.cause.code, 'Corrupt');
    assert.deepEqual(error.errors, [error.cause, cleanupFailure]);
    assert.deepEqual(error.details.cleanupErrors, [{ code: 'Quota', message: cleanupFailure.message }]);
    return true;
  });
  assert.equal(staging.state.stored.length, 1);
  assert.deepEqual(staging.state.deleted, staging.state.stored);
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
  assert.equal(response.body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(30 * 60_000);
  assert.equal(fetchSignal.aborted, false);
});

test('pack reading retains the original error and both failures when staging and stream cleanup reject', async () => {
  const bytes = await pendingDeltaThenInvalidEntry();
  const stagingFailure = new GitError('Quota', 'Cannot remove pending delta');
  const streamFailure = new Error('Cannot close source');
  const staging = failingStaging(stagingFailure);
  let cancellations = 0;
  const source = new ReadableStream({
    start(controller) { controller.enqueue(bytes); },
    cancel() {
      cancellations++;
      throw streamFailure;
    }
  });
  await assert.rejects(readPack(source, { staging }), error => {
    assert.equal(error.code, 'Corrupt');
    assert.equal(error.message, 'Invalid pack object type');
    assert.deepEqual(error.errors, [error.cause, stagingFailure, streamFailure]);
    assert.equal(error.details.cleanupErrors.length, 2);
    return true;
  });
  assert.equal(cancellations, 1);
  assert.equal(source.locked, false);
});

test('successful cleanup preserves the exact primary error and still closes the response', async () => {
  const primary = new GitError('Network', 'Receiving observer failed');
  const { pack } = await writePack([{ type: 'blob', data: Uint8Array.of(65) }]);
  let cancellations = 0;
  const source = new ReadableStream({
    start(controller) { controller.enqueue(concatBytes([pack, new Uint8Array(128)])); },
    cancel() { cancellations++; }
  });
  await assert.rejects(readPack(source, { onProgress() { throw primary; } }), error => {
    assert.equal(error, primary);
    return true;
  });
  assert.equal(cancellations, 1);
  assert.equal(source.locked, false);
});
