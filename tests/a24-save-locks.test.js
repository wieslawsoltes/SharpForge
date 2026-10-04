import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSaveLocks} from '@sharpforge/workspace';

test('file saves and whole-workspace transactions use the same workspace ownership key', async () => {
  const requests = [];
  const locks = {request: async (name, options, action) => { requests.push({name, mode: options.mode}); return action(); }};
  const coordinator = new WorkspaceSaveLocks({identity: 'directory:physical', locks});
  await coordinator.run('A.cs', () => {});
  await coordinator.run('*', () => {}, {workspace: true});
  assert.equal(requests[0].name, requests[2].name);
  assert.notEqual(requests[0].name, requests[1].name);
  assert.deepEqual(requests.map(request => request.mode), ['shared', 'exclusive', 'exclusive']);
  coordinator.dispose();
});
