import test from 'node:test';
import assert from 'node:assert/strict';
import {startStudioWorkspace} from '../apps/studio/workbench/studio-workspace-startup.js';

function startupFixture(recover) {
  const calls = [];
  const state = {workspaceEpoch: 1, revision: 1, disk: null, nativeMode: false, recoveryReadOnly: false};
  const context = {
    state, recover, services: {documents: {disposed: false}},
    projects: {selectedId: 'App', sourceUris: () => ['App.cs']},
    renderWorkspace: () => calls.push('render'), build: () => calls.push('build'),
    loadSample: () => calls.push('sample'), toast: message => calls.push(['error', message])
  };
  const shell = {startup: options => { calls.push(['startup', options.recovered]); return options; }};
  return {context, shell, state, calls};
}

test('asynchronous recovery finishes adoption before startup and never races a fallback sample', async () => {
  const recovery = Promise.withResolvers();
  const fixture = startupFixture(() => recovery.promise);
  const ready = startStudioWorkspace(fixture.context, fixture.shell);
  assert.deepEqual(fixture.calls, []);
  fixture.state.recoveryReadOnly = true;
  fixture.state.workspaceEpoch++;
  recovery.resolve(true);
  assert.deepEqual(await ready, {recovered: true});
  assert.deepEqual(fixture.calls, ['render', ['startup', true]]);
});

test('a failed recovery result cannot replace a workspace opened while it was pending', async () => {
  const recovery = Promise.withResolvers();
  const fixture = startupFixture(() => recovery.promise);
  const ready = startStudioWorkspace(fixture.context, fixture.shell);
  fixture.state.revision++;
  recovery.resolve(false);
  assert.deepEqual(await ready, {cancelled: true});
  assert.deepEqual(fixture.calls, []);
});

test('recovery rejection is observed and reported without starting a sample or launch', async () => {
  const failure = new Error('Recovery permission denied');
  const fixture = startupFixture(() => Promise.reject(failure));
  assert.deepEqual(await startStudioWorkspace(fixture.context, fixture.shell), {error: failure, recovered: false});
  assert.deepEqual(fixture.calls, [['error', failure.message]]);
});

test('synchronous recovery keeps immediate sample admission and observes its completion before startup', async () => {
  const sample = Promise.withResolvers();
  const fixture = startupFixture(() => false);
  fixture.context.loadSample = () => { fixture.calls.push('sample'); return sample.promise; };
  const ready = startStudioWorkspace(fixture.context, fixture.shell);
  assert.deepEqual(fixture.calls, ['sample']);
  sample.resolve();
  await ready;
  assert.deepEqual(fixture.calls, ['sample', ['startup', false]]);
});
