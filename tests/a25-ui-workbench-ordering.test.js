import test from 'node:test';
import assert from 'node:assert/strict';
import { gitViewFixture } from './git-views/fixture.js';
import { deferred } from './git-workspace/fixture.js';

const timeout = { timeout: 10000 };
const details = fixture => fixture.requests.filter(call => call.method === 'conflictDetail');
const outcome = promise => promise.then(value => ({ failed: false, value }), error => ({ failed: true, error }));

test('real workspace adoption defers reentrant mounted views and refresh until the operation owns fresh status', timeout, async t => {
  const fixture = await gitViewFixture(t);
  const { workbench, repo, mount } = fixture;
  await fixture.render();
  const settledSignal = details(fixture)[0].options.signal;
  const generation = mount.gitGeneration;
  const adopted = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const renders = [];
  fixture.onWorkspaceRender = () => {
    assert.equal(workbench.busy, true);
    assert.equal(workbench.changes.some(change => change.conflict), true, 'The host renders before status is refreshed');
    renders.push(fixture.render());
  };
  const operation = workbench.run(async options => {
    await fixture.resolve(options);
    await Promise.all(renders);
    assert.equal(settledSignal.aborted, false, 'An active button action must retain its settled view lifetime');
    adopted.resolve();
    await finish.promise;
    return 'resolved';
  }, { workspace: true });
  await adopted.promise;
  assert.ok(mount.gitGeneration > generation);
  assert.equal(repo.index.unmerged.length, 0);
  assert.equal(details(fixture).length, 1);
  const requestCount = fixture.requests.length;
  assert.equal(await workbench.refresh(), false, 'A reentrant refresh must defer without waiting on its own operation');
  assert.equal(fixture.requests.length, requestCount);
  finish.resolve();
  assert.equal(await operation, 'resolved');
  assert.equal(settledSignal.aborted, true);
  assert.equal(workbench.changes.some(change => change.conflict), false);
  assert.match(fixture.element.textContent, /No unresolved conflict/u);
  assert.equal(details(fixture).length, 1);
  assert.deepEqual(fixture.toasts, []);
});

test('queued renders and awaited disposers recheck operation ownership before requesting conflict details', timeout, async t => {
  for (const boundary of ['queue', 'disposer']) await t.test(boundary, timeout, async t => {
    const fixture = await gitViewFixture(t);
    const waiting = deferred();
    const release = deferred();
    const mutated = deferred();
    const finish = deferred();
    t.after(() => { release.resolve(); finish.resolve(); });
    if (boundary === 'queue') fixture.mount.rendering = release.promise;
    else fixture.mount.dispose = async () => { waiting.resolve(); await release.promise; };
    const pending = fixture.render();
    if (boundary === 'disposer') await waiting.promise;
    const operation = fixture.workbench.run(async options => {
      await fixture.resolve(options);
      await fixture.render();
      mutated.resolve();
      await finish.promise;
    }, { workspace: true });
    await mutated.promise;
    release.resolve();
    await pending;
    assert.equal(details(fixture).length, 0);
    finish.resolve();
    await operation;
    assert.match(fixture.element.textContent, /No unresolved conflict/u);
    assert.deepEqual(fixture.toasts, []);
  });
});

test('only obsolete in-flight renderer failures retire across operation, selection, repository and unmount boundaries', timeout, async t => {
  for (const boundary of ['operation', 'selection', 'repository', 'unmount']) await t.test(boundary, timeout, async t => {
    const fixture = await gitViewFixture(t, { conflict: false });
    fixture.workbench.changes = [{ path: fixture.path, conflict: true }];
    const reply = deferred();
    const release = deferred();
    const finish = deferred();
    t.after(() => { release.resolve(); finish.resolve(); });
    fixture.intercept = async call => {
      if (call.method !== 'conflictDetail') return call.invoke();
      try { return await call.invoke(); }
      catch (error) {
        assert.equal(error.code, 'NotFound');
        reply.resolve({ error, signal: call.options.signal });
        await release.promise;
        throw error;
      }
    };
    const pending = fixture.workbench.safe(() => fixture.render());
    const received = await reply.promise;
    let operation;
    if (boundary === 'operation') operation = fixture.workbench.run(() => finish.promise);
    else if (boundary === 'selection') fixture.workbench.selection = { path: 'other.dat' };
    else if (boundary === 'repository') fixture.workbench.repositoryId = 'other-repository';
    else fixture.mount.gitMounted = false;
    release.resolve();
    await pending;
    assert.deepEqual(fixture.toasts, []);
    assert.equal(received.signal.aborted, true);
    assert.equal(fixture.element.textContent, '');
    finish.resolve();
    await operation;
  });
});

test('a successful hidden merge reply cannot paint after another panel changes shared selection', timeout, async t => {
  const fixture = await gitViewFixture(t);
  const reply = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  fixture.intercept = async call => {
    const value = await call.invoke();
    if (call.method === 'conflictDetail') { reply.resolve(call.options.signal); await release.promise; }
    return value;
  };
  const pending = fixture.render();
  const signal = await reply.promise;
  const generation = fixture.mount.gitGeneration;
  fixture.workbench.selection = { path: 'history.dat', commit: 'historical-selection' };
  assert.equal(fixture.mount.gitGeneration, generation, 'Opening another panel does not rerender the hidden merge mount');
  release.resolve();
  await pending;
  assert.equal(fixture.element.textContent, '');
  assert.equal(signal.aborted, true);
});

test('a late pre-operation status response cannot overwrite the resolved index snapshot', timeout, async t => {
  const fixture = await gitViewFixture(t);
  await fixture.render();
  const reply = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  let held = false;
  fixture.intercept = async call => {
    const value = await call.invoke();
    if (call.method === 'status' && !held) {
      held = true;
      assert.equal(value.some(change => change.conflict), true);
      reply.resolve(call.options.signal);
      await release.promise;
    }
    return value;
  };
  const earlier = fixture.workbench.refresh({ render: false });
  const signal = await reply.promise;
  await fixture.workbench.run(options => fixture.resolve(options), { workspace: true });
  assert.equal(signal.aborted, true);
  assert.equal(fixture.workbench.changes.some(change => change.conflict), false);
  release.resolve();
  assert.equal(await earlier, false);
  assert.equal(fixture.workbench.changes.some(change => change.conflict), false);
  assert.match(fixture.element.textContent, /No unresolved conflict/u);
  assert.deepEqual(fixture.toasts, []);
});

test('a committed adoption failure still refreshes real resolved stages without a stale conflict request', timeout, async t => {
  const fixture = await gitViewFixture(t);
  await fixture.render();
  const failure = new Error('Workspace save failed after adoption');
  fixture.onSave = () => { throw failure; };
  const result = await outcome(fixture.workbench.run(options => fixture.resolve(options), { workspace: true }));
  assert.equal(result.failed, true);
  assert.equal(result.error.committed, true);
  assert.deepEqual(result.error.errors, [failure]);
  assert.equal(fixture.repo.index.unmerged.length, 0);
  assert.equal(fixture.workbench.changes.some(change => change.conflict), false);
  assert.match(fixture.element.textContent, /No unresolved conflict/u);
  assert.equal(details(fixture).length, 1);
  assert.deepEqual(fixture.toasts, []);
});

test('current render failures retain exact worker and falsy causes while reporting stays non-throwing', timeout, async t => {
  const fixture = await gitViewFixture(t, { conflict: false });
  fixture.workbench.changes = [{ path: fixture.path, conflict: true }];
  const missing = await outcome(fixture.render());
  assert.equal(missing.failed, true);
  assert.equal(missing.error.code, 'NotFound');
  assert.equal(missing.error.message, 'Path has no unresolved index stages');
  for (const failure of [undefined, null, false]) {
    fixture.intercept = async () => { throw failure; };
    const current = await outcome(fixture.render());
    assert.equal(current.failed, true);
    assert.equal(current.error, failure);
    await fixture.workbench.safe(() => Promise.reject(failure));
    assert.equal(fixture.toasts.at(-1).message, String(failure));
  }
});

test('a current falsy render failure cannot replace the operation failure while reporting final views', timeout, async t => {
  const fixture = await gitViewFixture(t);
  await fixture.render();
  fixture.intercept = call => call.method === 'conflictDetail' ? Promise.reject(undefined) : call.invoke();
  const result = await outcome(fixture.workbench.run(async () => { throw false; }));
  assert.equal(result.failed, true);
  assert.equal(result.error, false);
  assert.deepEqual(fixture.toasts, [{ message: 'undefined', kind: 'error' }]);
  assert.equal(fixture.workbench.busy, false);
});

test('operation and status-query failures preserve both exact falsy values', timeout, async t => {
  const fixture = await gitViewFixture(t);
  fixture.intercept = call => call.method === 'status' ? Promise.reject(undefined) : call.invoke();
  const result = await outcome(fixture.workbench.run(async () => { throw false; }));
  assert.equal(result.failed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, [false, undefined]);
  assert.equal(fixture.workbench.busy, false);
});

test('obsolete render and refresh cleanup failures remain visible with their exact falsy identity', timeout, async t => {
  for (const boundary of ['render-disposer', 'annotations']) await t.test(boundary, timeout, async t => {
    const fixture = await gitViewFixture(t);
    const started = deferred();
    const release = deferred();
    const finish = deferred();
    t.after(() => { release.resolve(); finish.resolve(); });
    let first = true;
    const dispose = async () => {
      if (!first) return;
      first = false;
      started.resolve();
      await release.promise;
      throw undefined;
    };
    if (boundary === 'render-disposer') fixture.mount.dispose = dispose;
    else fixture.workbench.reviewAnnotations = { dispose };
    const old = outcome(boundary === 'render-disposer' ? fixture.render() : fixture.workbench.refresh({ render: false }));
    await started.promise;
    const operation = fixture.workbench.run(() => finish.promise);
    release.resolve();
    const result = await old;
    assert.equal(result.failed, true);
    assert.equal(result.error, undefined);
    finish.resolve();
    await operation;
  });
});
