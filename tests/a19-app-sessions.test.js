import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../apps/studio/workbench/session-manager.js';
import { OutputChannels } from '../apps/studio/workbench/output-channels.js';
import { createRuntimeFacade, legacyDebug, legacyRuntimeEvent } from '../apps/studio/workbench/session-compat.js';
import { createWorkspaceState } from '../apps/studio/workbench/state.js';
import { SessionBreakpoints } from '../apps/studio/workbench/session-breakpoints.js';
import { SessionSettings } from '../apps/studio/workbench/session-settings.js';
import { routeSessionEvents } from '../apps/studio/workbench/session-events.js';
import { sessionStatus } from '../apps/studio/workbench/session-status.js';
import { fakeWorkers, fakeRuntime } from './a19-session-fixtures.js';

const launch = session => session.launch({ assembly: new Uint8Array([1]), debug: true });

test('two runtime workers may use serial 1 without sharing output, debug state or legacy identity', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const output = new OutputChannels();
  const sessions = new SessionManager({ workerFactory: fake.factory, output });
  const a = sessions.create({ projectId: 'A', name: 'Alpha' });
  const b = sessions.create({ projectId: 'B', name: 'Beta' });
  await Promise.all([launch(a), launch(b)]);
  assert.equal(a.runtimeSession, 1);
  assert.equal(b.runtimeSession, 1);
  assert.notEqual(legacyDebug(a).sessionId, legacyDebug(b).sessionId);
  fake.workers[0].emit({ event: 'output', sessionId: 1, text: 'alpha\n' });
  fake.workers[1].emit({ event: 'output', sessionId: 1, text: 'beta\n' });
  assert.equal(a.programOutput, 'alpha\n');
  assert.equal(b.programOutput, 'beta\n');
  fake.workers[0].emit({ event: 'state', sessionId: 1, state: 'paused', output: 'alpha\n', frames: [{ id: 11 }], stats: {} });
  assert.equal(a.frameId, 11);
  assert.equal(b.state, 'running');
  assert.equal(b.frameId, null);
  assert.equal(a.programOutput, 'alpha\n', 'state snapshot must not duplicate streamed output');
  sessions.dispose();
  output.dispose();
});

test('legacy runtime facade translates matching identities and rejects app-switch races', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  const runtime = createRuntimeFacade(sessions);
  sessions.setActive(a.id);
  const identity = legacyDebug(a).sessionId;
  await runtime.request('evaluate', { expression: 'x', sessionId: identity });
  assert.equal(fake.workers[0].requests.at(-1).params.sessionId, 1);
  sessions.setActive(b.id);
  await assert.rejects(runtime.request('evaluate', { expression: 'x', sessionId: identity }), { code: 'SESSION_STALE' });
  assert.equal(fake.workers[1].requests.length, 1);
  const event = legacyRuntimeEvent(b, { event: 'state', sessionId: 1 });
  assert.equal(event.sessionId, b.identity);
  assert.equal(event.runtimeSessionId, 1);
  sessions.dispose();
});

test('restart replaces only its worker and stale callbacks cannot replace the new generation', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  const oldIdentity = a.identity;
  const preserved = b.identity;
  await a.restart();
  assert.notEqual(a.identity, oldIdentity);
  assert.equal(b.identity, preserved);
  assert.equal(fake.workers[1].terminated, false);
  fake.workers[0].emit({ event: 'output', sessionId: 99, text: 'old worker' });
  assert.equal(a.programOutput, '');
  assert.equal(b.state, 'running');
  sessions.dispose();
});

test('ending the active application selects the most recently active remaining app with ordered events', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  sessions.setActive(a.id);
  sessions.setActive(b.id);
  const events = [];
  sessions.subscribe(event => events.push([event.type, event.sequence]));
  await b.stop();
  assert.equal(sessions.active, a);
  assert.equal(a.state, 'running');
  assert.ok(events.findIndex(([type]) => type === 'ended') < events.findIndex(([type]) => type === 'selected'));
  assert.ok(events.every(([, sequence], index) => index === 0 || sequence > events[index - 1][1]));
  sessions.dispose();
});

test('resource limit refuses a new app without touching live workers', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory, maxSessions: 2 });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  assert.throws(() => sessions.create({ projectId: 'C' }), { code: 'SESSION_LIMIT' });
  assert.equal(fake.workers.length, 2);
  assert.equal(fake.workers.some(worker => worker.terminated), false);
  sessions.dispose();
});

test('background events update their app while shared debugger callbacks remain on the selected app', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  sessions.setActive(a.id);
  const updates = [];
  const ui = [];
  const dispose = routeSessionEvents(sessions, {
    onActiveState: (state, session) => updates.push(session.id),
    onActiveOutput: (text, session) => updates.push(session.id),
    onApplicationUI: session => ui.push(session.id)
  });
  fake.workers[1].emit({ event: 'output', sessionId: 1, text: 'background' });
  fake.workers[1].emit({ event: 'state', sessionId: 1, state: 'paused', frames: [], output: 'background', stats: {} });
  fake.workers[1].emit({ event: 'ui', sessionId: 1, commands: [] });
  assert.deepEqual(updates, []);
  assert.deepEqual(ui, [b.id]);
  assert.equal(sessions.activeId, a.id);
  dispose();
  sessions.dispose();
});

test('state compatibility accessors follow the selected session without aliasing their mutable maps', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  await Promise.all([launch(a), launch(b)]);
  const facade = createWorkspaceState({ debug: null, programOutput: '', debugSources: new Map(), frameId: null }, { sessions });
  sessions.setActive(a.id);
  facade.state.programOutput = 'A';
  facade.state.frameId = 7;
  facade.state.debugSources.set('A.cs', 'source A');
  sessions.setActive(b.id);
  assert.equal(facade.state.programOutput, '');
  assert.equal(facade.state.frameId, null);
  assert.equal(facade.state.debugSources.has('A.cs'), false);
  assert.equal(facade.state.debug.sessionId, b.identity);
  facade.dispose();
  sessions.dispose();
});

test('breakpoint edits bind only to sessions belonging to the owning project', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  const a2 = sessions.create({ projectId: 'A' });
  await Promise.all([launch(a), launch(b), launch(a2)]);
  const breakpoints = new SessionBreakpoints(sessions);
  const result = await breakpoints.set('A', 'A.cs', [{ line: 3, condition: 'x > 2' }]);
  assert.equal(result.updated, 2);
  assert.equal(fake.workers[0].requests.at(-1).method, 'breakpoints');
  assert.equal(fake.workers[1].requests.length, 1);
  assert.equal(fake.workers[2].requests.at(-1).method, 'breakpoints');
  assert.equal(breakpoints.forProject('B')['A.cs'], undefined);
  breakpoints.dispose();
  sessions.dispose();
});

test('session grant edits never leak to another app and revocation stops only its owner', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A' });
  const b = sessions.create({ projectId: 'B' });
  const settings = new SessionSettings(sessions);
  settings.grant(a.id, 'https://api.example.com');
  assert.deepEqual(settings.get(b.id).allowedOrigins, []);
  await Promise.all([launch(a), launch(b)]);
  assert.deepEqual(fake.workers[0].requests[0].params.network.allowedOrigins, ['https://api.example.com']);
  assert.deepEqual(fake.workers[1].requests[0].params.network.allowedOrigins, []);
  await settings.revoke(a.id);
  assert.equal(a.state, 'stopped');
  assert.equal(b.state, 'running');
  assert.equal(JSON.stringify(settings.exportPreferences(a.id)).includes('allowedOrigins'), false);
  assert.throws(() => settings.grant(b.id, 'https://example.com/path'));
  settings.dispose();
  sessions.dispose();
});

test('combined debug status reflects multiple applications and exact paused count', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const a = sessions.create({ projectId: 'A', name: 'Alpha' });
  const b = sessions.create({ projectId: 'B', name: 'Beta' });
  await Promise.all([launch(a), launch(b)]);
  fake.workers[0].emit({ event: 'state', sessionId: 1, state: 'paused', output: '', frames: [], stats: {} });
  assert.deepEqual(sessionStatus(sessions), {
    id: 'debug-state', state: 'break', text: '2 applications · 1 running · 1 paused', count: 2,
    paused: 1, running: 1, sessionId: b.id
  });
  sessions.dispose();
});

test('a ended active session can be retired at a one-session limit and releases retained output', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const output = new OutputChannels({ maxChannels: 7 });
  const sessions = new SessionManager({ workerFactory: fake.factory, output, maxSessions: 1 });
  const first = sessions.create({ projectId: 'A' });
  await launch(first);
  await first.stop();
  const second = sessions.create({ projectId: 'B' });
  await launch(second);
  assert.equal(sessions.active, second);
  assert.equal(output.get(first.channelId), null);
  assert.equal(fake.workers[0].terminated, true);
  sessions.dispose();
  output.dispose();
});

test('worker failure clears stale live UI flags and unlocks only the failed app', async () => {
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const first = sessions.create({ projectId: 'A' });
  const second = sessions.create({ projectId: 'B' });
  await Promise.all([launch(first), launch(second)]);
  fake.workers[0].emit({ event: 'state', sessionId: 1, state: 'terminated', uiActive: true, output: '', stats: {} });
  assert.equal(first.live, true);
  fake.workers[0].onerror({ message: 'runtime crashed' });
  assert.equal(first.live, false);
  assert.equal(first.readOnly, false);
  assert.equal(legacyDebug(first).state, 'faulted');
  assert.equal(second.live, true);
  sessions.dispose();
});
