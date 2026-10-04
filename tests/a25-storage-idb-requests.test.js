import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createIdbTransaction } from '../packages/git/src/storage/idb-transaction.js';

function transaction(objectStore) {
  return createIdbTransaction({ objectStore, repositoryId: 'request-lifecycle', chunkBytes: 2, maxValueBytes: 8,
    keyRange: { bound: (lower, upper) => ({ lower, upper }) } });
}

function abort(request) {
  request.error = new DOMException('The transaction was aborted, so the request cannot be fulfilled.', 'AbortError');
  request.onerror();
}

test('synchronous IndexedDB quota failure retains its error and observes the aborted prior request', async () => {
  const deletion = {};
  const quota = new DOMException('Injected storage quota exhaustion', 'QuotaExceededError');
  const tx = transaction({ delete: () => deletion, put() { throw quota; } });
  await assert.rejects(tx.set('objects/pack/example.idx', Uint8Array.of(1, 2)), error => error === quota);
  abort(deletion);
  // An orphaned request rejection is reported by the test runner at the next turn.
  await setImmediate();
});

test('synchronous chunk-read enqueue failure observes requests queued before the failure', async () => {
  const metadata = { result: { length: 4, chunks: 2 } };
  const firstChunk = {};
  const failure = new DOMException('Transaction became inactive', 'TransactionInactiveError');
  const tx = transaction({ get(key) {
    if (key[2] === 0) return metadata;
    if (key[2] === 1) return firstChunk;
    throw failure;
  } });
  const pending = tx.get('objects/value');
  metadata.onsuccess();
  await assert.rejects(pending, error => error === failure);
  abort(firstChunk);
  await setImmediate();
});

test('chunk request completion order cannot change the stored byte order', async () => {
  const requests = [{ result: { length: 4, chunks: 2 } },
    { result: Uint8Array.of(1, 2) }, { result: Uint8Array.of(3, 4) }];
  const tx = transaction({ get: key => requests[key[2]] });
  const pending = tx.get('objects/value');
  requests[0].onsuccess();
  await Promise.resolve();
  requests[2].onsuccess();
  requests[1].onsuccess();
  assert.deepEqual(await pending, Uint8Array.of(1, 2, 3, 4));
});
