import test from 'node:test';
import assert from 'node:assert/strict';
import { Claims, claimRef, lockRef, operationRef } from '../../../scripts/planning/lib/claims.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';

const task = 'SF-A00-T07.1';
const original = { issue: 1, agent: 'codex-generation-owner', branch: 'codex/generation-first' };

function fixture() {
  const fake = new FakeGitHub();
  const client = new GitHubProject({ owner: 'test', transport: fake.transport });
  let milliseconds = Date.parse('2026-10-04T12:00:00.000Z');
  let generation = 0;
  const clock = {
    now: () => new Date(milliseconds),
    uuid: () => `00000000-0000-4000-8000-${String(++generation).padStart(12, '0')}`,
  };
  return {
    fake, client, clock, owner: new Claims(client, clock),
    advance: value => { milliseconds += value; },
  };
}

// Suspend one client's first mutex creation after it has inspected the old claim.
// Other clients remain free to complete a real release/reclaim via the fake API.
function beforeMutex(fake, clock) {
  const entered = Promise.withResolvers();
  const resumed = Promise.withResolvers();
  let intercepted = false;
  const client = new GitHubProject({
    owner: 'test',
    transport: async request => {
      if (!intercepted && request.method === 'POST' && request.path.endsWith('/git/refs') &&
          request.body.ref === `refs/heads/${operationRef(task)}`) {
        intercepted = true;
        entered.resolve();
        await resumed.promise;
      }
      return fake.transport(request);
    },
  });
  return { claims: new Claims(client, clock), entered: entered.promise, resume: resumed.resolve };
}

function retainedState(fake) {
  return structuredClone({
    refs: [...fake.refs],
    objects: [...fake.objects],
    fields: fake.issues[0].fields,
    labels: fake.issues[0].labels,
    comments: fake.issues[0].comments,
  });
}

async function replaceClaim(context, replacement = { ...original, branch: 'codex/generation-next' }) {
  await context.owner.release(original);
  const record = await context.owner.claim(replacement);
  await context.owner.lock({ ...replacement, key: 'studio' });
  return record;
}

test('a stale explicit reconciler cannot release a replacement agent or its locks', async () => {
  const context = fixture();
  const first = await context.owner.claim(original);
  const gate = beforeMutex(context.fake, context.clock);
  const pending = gate.claims.release({ issue: 1, agent: 'codex-integrator', reconcile: true, reason: 'Old owner stopped' });
  const rejected = assert.rejects(pending, /claim generation changed or was released/);
  await gate.entered;
  const replacement = await replaceClaim(context, { ...original, agent: 'codex-replacement', branch: 'codex/replacement' });
  assert.notEqual(replacement.generation, first.generation);
  const retained = retainedState(context.fake);
  gate.resume();
  await rejected;
  assert.deepEqual(retainedState(context.fake), retained);
  assert.ok(context.fake.refs.has(`refs/heads/${claimRef(task)}`));
  assert.ok(context.fake.refs.has(`refs/heads/${lockRef('studio')}`));
  assert.equal(context.fake.refs.has(`refs/heads/${operationRef(task)}`), false);
});

for (const operation of ['heartbeat', 'lock', 'unlock', 'release']) {
  test(`a stale ${operation} cannot mutate a new generation reusing the same agent ID`, async () => {
    const context = fixture();
    await context.owner.claim(original);
    const gate = beforeMutex(context.fake, context.clock);
    const pending = operation === 'unlock'
      ? gate.claims.lock({ ...original, key: 'studio', release: true })
      : gate.claims[operation]({ ...original, key: 'studio', ttlHours: 48 });
    const rejected = assert.rejects(pending, /claim generation changed or was released/);
    await gate.entered;
    await replaceClaim(context);
    const retained = retainedState(context.fake);
    gate.resume();
    await rejected;
    assert.deepEqual(retainedState(context.fake), retained);
  });
}

test('a disappeared claim reports stale ownership and removes only the temporary operation mutex', async () => {
  const context = fixture();
  await context.owner.claim(original);
  const gate = beforeMutex(context.fake, context.clock);
  const pending = gate.claims.release(original);
  const rejected = assert.rejects(pending, /claim generation changed or was released/);
  await gate.entered;
  await context.owner.release(original);
  const retained = retainedState(context.fake);
  gate.resume();
  await rejected;
  assert.deepEqual(retainedState(context.fake), retained);
});

test('an expired-lease reaper cannot label or report a replacement generation', async () => {
  const context = fixture();
  await context.owner.claim(original);
  context.advance(25 * 3600000);
  const gate = beforeMutex(context.fake, context.clock);
  const pending = gate.claims.reap();
  const rejected = assert.rejects(pending, /claim generation changed or was released/);
  await gate.entered;
  await replaceClaim(context);
  context.advance(25 * 3600000);
  const retained = retainedState(context.fake);
  gate.resume();
  await rejected;
  assert.deepEqual(retainedState(context.fake), retained);
});

test('a same-generation heartbeat between inspection and mutex acquisition remains valid', async () => {
  const context = fixture();
  const first = await context.owner.claim(original);
  const gate = beforeMutex(context.fake, context.clock);
  const pending = gate.claims.lock({ ...original, key: 'studio' });
  await gate.entered;
  context.advance(3600000);
  const advanced = await context.owner.heartbeat(original);
  assert.equal(advanced.generation, first.generation);
  assert.ok(advanced.sequence > first.sequence);
  gate.resume();
  const result = await pending;
  assert.equal(result.generation, first.generation);
  assert.equal(result.expires, advanced.expires);
  assert.equal(result.heartbeat, advanced.heartbeat);
  assert.equal(result.sequence, advanced.sequence + 1);
  assert.deepEqual(result.locks, ['studio']);
  assert.equal(context.fake.refs.has(`refs/heads/${operationRef(task)}`), false);
});

test('a task identity change cannot redirect an operation to an unrelated mutex namespace', async () => {
  const context = fixture();
  await context.owner.claim(original);
  const gate = beforeMutex(context.fake, context.clock);
  const pending = gate.claims.release(original);
  const rejected = assert.rejects(pending, /claim generation changed or was released/);
  await gate.entered;
  context.fake.issues[0].content.title = '[SF-A00-T07.2] Renamed fixture';
  const retained = retainedState(context.fake);
  gate.resume();
  await rejected;
  assert.deepEqual(retainedState(context.fake), retained);
});

test('missing claim generation fails before acquiring a mutex or invoking the action', async () => {
  const context = fixture();
  await context.owner.claim(original);
  const state = await context.owner.state(1);
  delete state.record.generation;
  const retained = retainedState(context.fake);
  let invoked = false;
  await assert.rejects(context.owner.exclusive(state, async () => { invoked = true; }), /no valid claim generation/);
  assert.equal(invoked, false);
  assert.deepEqual(retainedState(context.fake), retained);
});
