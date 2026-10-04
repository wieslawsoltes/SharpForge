import test from 'node:test';
import assert from 'node:assert/strict';
import { GIT_WORKER_LIMITS, validateGitMessage } from '../packages/git/src/worker/protocol.js';

test('a full 64 MiB artifact fits its bounded worker envelope without relaxing the total payload limit', () => {
  const bytes = new Uint8Array(GIT_WORKER_LIMITS.maxArtifactBytes);
  const message = { version: 1, type: 'request', session: 'archive-boundary', id: 1, method: 'importZip',
    params: { repositoryId: 'default', bytes, prefix: 'src', stage: false, overwrite: false } };
  assert.equal(GIT_WORKER_LIMITS.maxArtifactBytes, 64 * 1024 * 1024);
  assert.equal(GIT_WORKER_LIMITS.maxEnvelopeBytes, 64 * 1024);
  assert.equal(validateGitMessage(message), message);
  assert.throws(() => validateGitMessage({ ...message, params: { ...message.params,
    padding: 'x'.repeat(GIT_WORKER_LIMITS.maxEnvelopeBytes) } }), { code: 'Limit' });
});
