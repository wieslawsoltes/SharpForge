import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { DebugLocation, mountDebugLocation } from '../apps/studio/workbench/debug-location.js';
import { mountProcesses } from '../apps/studio/workbench/processes.js';
import { mountSessionStatus } from '../apps/studio/workbench/session-status.js';
import { fakeWorkers, fakeRuntime, settle } from './a19-session-fixtures.js';
import { sessionDomRoot, descendants } from './a19-session-dom-fixture.js';

async function applications(respond) {
  const workers = fakeWorkers((message, worker) => respond?.(message, worker) ?? fakeRuntime(message, worker));
  const services = createWorkbenchServices({ workerFactory: workers.factory });
  const alpha = services.sessions.create({ id: 'alpha', projectId: 'A', name: 'Alpha' });
  const beta = services.sessions.create({ id: 'beta', projectId: 'B', name: 'Beta' });
  await alpha.launch({ image: {} });
  await beta.launch({ image: {} });
  services.sessions.setActive(beta.id);
  return { services, alpha, beta };
}

test('Processes row controls affect only that row across active-application changes', async () => {
  const { services, alpha, beta } = await applications();
  const betaIdentity = beta.identity;
  const betaWorker = beta.worker.worker;
  const root = sessionDomRoot();
  const view = mountProcesses(root, { sessions: services.sessions });
  const click = async label => {
    const button = descendants(root, node => node.attributes['aria-label'] === `${label} Alpha`)[0];
    assert(button && !button.disabled, label);
    button.dispatchEvent(new Event('click'));
    await settle();
  };
  await click('Break');
  assert.equal(alpha.worker.worker.requests.at(-1).method, 'pause');
  alpha.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', frames: [], threads: [] });
  await click('Continue');
  assert.equal(alpha.worker.worker.requests.some(request => request.method === 'resume'), true);
  await click('Detach');
  assert.equal(alpha.detached, true);
  await click('Restart');
  assert.equal(alpha.detached, false);
  await click('Stop');
  assert.equal(alpha.live, false);
  assert.equal(beta.state, 'running');
  assert.equal(beta.identity, betaIdentity);
  assert.equal(beta.worker.worker, betaWorker);
  assert.deepEqual(betaWorker.requests.map(request => request.method), ['launch']);
  view.dispose();
  assert.equal(root.children.length, 0);
  services.dispose();
});

test('Debug Location process/thread/frame selection owns its locals and does not navigate a background app', async () => {
  const { services, alpha, beta } = await applications((message, worker) => {
    if (message.method === 'stackTrace') return [{ id: 17, name: worker.options.name, uri: `${worker.options.name}.cs`, line: 4 }];
    if (message.method === 'locals') return [{ name: 'owner', value: worker.options.name }];
  });
  alpha.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', threads: [{ id: 7 }], frames: [] });
  const navigated = [];
  const location = new DebugLocation(services.sessions, { onNavigate: (frame, session) => navigated.push([frame.id, session.id]) });
  await location.selectThread(7, alpha.id);
  assert.equal(alpha.frameId, 17);
  assert.deepEqual(alpha.inspectedLocals, [{ name: 'owner', value: 'runtime:alpha' }]);
  assert.equal(beta.inspectedLocals, null);
  assert.deepEqual(navigated, []);
  const root = sessionDomRoot();
  const view = mountDebugLocation(root, { sessions: services.sessions, location });
  const process = descendants(root, node => node.attributes['aria-label'] === 'Process')[0];
  process.value = alpha.id;
  process.dispatchEvent(new Event('change'));
  assert.equal(services.sessions.activeId, alpha.id);
  await location.selectFrame(17);
  assert.deepEqual(navigated, [[17, alpha.id]]);
  await assert.rejects(location.selectThread(999), { code: 'THREAD_MISSING' });
  await assert.rejects(location.selectFrame(999), { code: 'FRAME_MISSING' });
  view.dispose();
  services.dispose();
});

test('status and title announce a meaning change once and ignore repeated output/state events', async () => {
  const { services, alpha } = await applications();
  const root = sessionDomRoot();
  const titles = [];
  const view = mountSessionStatus(root, services.sessions, { title: 'TwoApps', setTitle: value => titles.push(value) });
  assert.equal(root.attributes['aria-live'], 'polite');
  assert.equal(root.textWrites, 1);
  alpha.emit('output', { text: 'first' });
  alpha.emit('output', { text: 'second' });
  assert.equal(root.textWrites, 1);
  alpha.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', frames: [], threads: [] });
  assert.equal(root.textWrites, 2);
  assert.equal(root.dataset.debugState, 'break');
  assert.match(titles.at(-1), /2 applications · 1 running · 1 paused/);
  alpha.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', frames: [], threads: [] });
  assert.equal(root.textWrites, 2);
  view.dispose();
  services.dispose();
});
