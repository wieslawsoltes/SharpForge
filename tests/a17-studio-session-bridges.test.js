import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor, CompositionTransport} from '@sharpforge/rendering';
import {ApplicationWindows} from '../apps/studio/workbench/application-window.js';
import {SessionManager} from '../apps/studio/workbench/session-manager.js';
import {routeSessionEvents} from '../apps/studio/workbench/session-events.js';
import {inspectorDocument} from './support/a19-inspector-fixture.js';
import {fakeWorkers, fakeRuntime, deferred, settle} from './a19-session-fixtures.js';

class Host {
  constructor(root, options) {
    Object.assign(this, {root, options, services: options.services, backend: options.backend, disposed: false});
    this.nodes = new Map();
    this.previews = new Map();
    this.privateValues = new Map();
    this.applied = [];
  }
  apply(commands) {
    this.applied.push(commands);
    for (const command of commands) {
      if (command.op === 'reset') this.nodes = new Map((command.snapshot?.nodes ?? []).map(node => [node.id, node]));
      if (command.op === 'create') this.nodes.set(command.id, command);
    }
  }
  scheduleRender() {}
  setBackend(value) { this.backend = value; }
  setElementComposition(id, entry) { this.previews.set(id, entry); }
  applyCompositionProperty() {}
  setCompositionBrush() {}
  setPrivateValue(id, property, value) { this.privateValues.set(id + ':' + property, value); }
  renderToBitmap(id, options) {
    return this.capture?.(id, options) ?? {width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255])};
  }
  dispose() { this.disposed = true; this.disposeCount = (this.disposeCount ?? 0) + 1; }
}

async function fixture(context, respond = fakeRuntime) {
  const fake = fakeWorkers(respond), sessions = new SessionManager({workerFactory: fake.factory});
  const alpha = sessions.create({projectId: 'Alpha', renderer: 'dom'});
  const beta = sessions.create({projectId: 'Beta', renderer: 'canvas2d'}, {activate: false});
  const document = inspectorDocument(), create = document.createElement;
  document.createElement = tag => {
    const node = create(tag);
    node.remove = () => { node.removed = true; };
    return node;
  };
  const hosts = [], errors = [], frames = new Map();
  let nextFrame = 0;
  const windows = new ApplicationWindows({sessions, document, registerPanel: () => () => {}, onError: error => errors.push(error),
    createHost: (root, options) => { const host = new Host(root, options); hosts.push(host); return host; },
    schedulerOptions: {requestFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelFrame: id => frames.delete(id)}});
  context.after(() => { windows.dispose(); sessions.dispose(); });
  await alpha.launch({});
  await beta.launch({});
  const emit = (session, event) => session.worker.worker.emit({sessionId: session.runtimeSession, ...event});
  const scene = session => emit(session, {event: 'ui', commands: [{op: 'create', id: 'shared',
    type: 'Microsoft.UI.Xaml.Controls.TextBlock', properties: {Text: session.name, Opacity: 1}}]});
  scene(alpha);
  scene(beta);
  return {fake, sessions, alpha, beta, windows, hosts, errors, frames, emit, scene};
}

test('application windows route private values and compositor graphs to their owning app with equal runtime serials', async context => {
  const f = await fixture(context);
  const alpha = f.windows.panels.get(f.alpha.id), beta = f.windows.panels.get(f.beta.id);
  const forwarded = [];
  context.after(routeSessionEvents(f.sessions, {onApplicationHostEvent: (session, event) => forwarded.push([session.id, event.event])}));
  assert.equal(f.alpha.runtimeSession, f.beta.runtimeSession);
  assert.notEqual(alpha.bridge, beta.bridge);
  f.emit(f.beta, {event: 'uiPrivateValues', values: [{id: 'shared', property: 'Password', value: 'private beta'}]});
  const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
  const transport = new CompositionTransport({session: 'beta-composition', enqueue() {},
    emit: packet => f.emit(f.beta, {event: 'uiComposition', packets: [structuredClone(packet)]})});
  transport.connect(compositor);
  context.after(() => compositor.dispose());
  const visual = compositor.CreateSpriteVisual();
  visual.Opacity = 0.35;
  transport.preview('shared', {visual});
  assert.equal(beta.host.privateValues.get('shared:Password'), 'private beta');
  assert.equal(alpha.host.privateValues.size, 0);
  assert.equal(beta.host.nodes.get('shared').properties.Password, undefined);
  assert.equal(beta.host.previews.get('shared').visual.Opacity, 0.35);
  assert.equal(alpha.host.previews.size, 0);
  assert.equal(alpha.host.applied.length, 1);
  assert.equal(beta.host.applied.length, 1);
  assert.equal(f.hosts.length, 2);
  assert.equal(f.sessions.active, f.alpha);
  assert.deepEqual(forwarded.map(([id]) => id), [f.beta.id, f.beta.id, f.beta.id]);
  assert.deepEqual(f.errors, []);
});

test('acknowledged and ordinary inputs capture the owning background app without duplicate dispatch', async context => {
  const f = await fixture(context, (message, worker) => message.method === 'uiEventRequest'
    ? {Cancel: true, Reason: message.params.payload.Reason} : fakeRuntime(message, worker));
  const options = f.windows.panels.get(f.beta.id).host.options;
  assert.deepEqual(await options.onEventRequest('shared', 'PaneClosing', {Cancel: false, Reason: 'back'}), {Cancel: true, Reason: 'back'});
  options.onPrivateInput('shared', 'Password', 'changed');
  options.onRealizeItems({id: 'shared', indices: [0, 2]});
  await settle();
  assert.equal(f.alpha.worker.worker.requests.filter(request => request.method.startsWith('ui')).length, 0);
  const requests = f.beta.worker.worker.requests.filter(request => request.method.startsWith('ui'));
  assert.deepEqual(requests.map(request => request.method), ['uiEventRequest', 'uiPrivateInput', 'uiRealizeItems']);
  assert.ok(requests.every(request => request.params.sessionId === 1));
  assert.ok(requests.every(request => request.params.identity === undefined), 'The facade resolves identity before worker transport');
  assert.equal(f.sessions.active, f.alpha);
  assert.deepEqual(f.errors, []);
});

test('worker restart disposes pending browser and managed requests even when its numeric runtime serial repeats', async context => {
  const decision = deferred();
  const f = await fixture(context, (message, worker) => message.method === 'uiEventRequest' ? decision.promise : fakeRuntime(message, worker));
  const panel = f.windows.panels.get(f.alpha.id), oldBridge = panel.bridge, oldHost = panel.host;
  const oldWorker = f.alpha.worker.worker, identity = f.alpha.identity;
  const pendingDecision = oldHost.options.onEventRequest('shared', 'PaneClosing', {Cancel: false});
  const cancelled = assert.rejects(pendingDecision, {name: 'AbortError'});
  const capture = deferred();
  let signal;
  oldHost.capture = (id, options) => { signal = options.signal; return capture.promise; };
  f.emit(f.alpha, {event: 'uiHostRequest', requestId: 'old-capture', kind: 'renderToBitmap', payload: {id: 'shared'}});
  assert.equal(oldBridge.pending.size, 1);
  await f.alpha.restart();
  await cancelled;
  f.scene(f.alpha);
  assert.equal(f.alpha.runtimeSession, 1);
  assert.notEqual(f.alpha.identity, identity);
  assert.notEqual(panel.bridge, oldBridge);
  assert.equal(oldBridge.closed, true);
  assert.equal(oldHost.disposeCount, 1);
  assert.equal(signal.aborted, true);
  assert.equal(oldBridge.pending.size, 0);
  assert.equal(oldHost.options.onPrivateInput('shared', 'Password', 'stale'), false);
  oldWorker.emit({event: 'uiPrivateValues', sessionId: 99, values: [{id: 'shared', property: 'Password', value: 'late'}]});
  oldBridge.receive({event: 'ui', sessionId: 99, commands: []});
  decision.resolve({Cancel: true});
  capture.resolve({width: 1, height: 1, pixels: new Uint8Array(4)});
  await settle();
  assert.equal(oldBridge.closed, true, 'A late packet cannot reopen a disposed bridge');
  assert.equal(panel.host.privateValues.size, 0);
  assert.equal(f.alpha.worker.worker.requests.filter(request => request.method === 'uiHostResponse').length, 0);
  assert.equal(f.windows.panels.get(f.beta.id).host.disposed, false);
  assert.deepEqual(f.errors, []);
});

test('pause cancels only the owning event request and resume restores input on the same retained host', async context => {
  const decision = deferred();
  const f = await fixture(context, (message, worker) => message.method === 'uiEventRequest' ? decision.promise : fakeRuntime(message, worker));
  const panel = f.windows.panels.get(f.beta.id), host = panel.host;
  const pending = host.options.onEventRequest('shared', 'BeforeTextChanging', {NewText: 'next', Cancel: false});
  const cancelled = assert.rejects(pending, {name: 'AbortError'});
  f.emit(f.beta, {event: 'state', state: 'paused', output: '', frames: [], stats: {}});
  await cancelled;
  assert.equal(panel.bridge.paused, true);
  assert.equal(f.windows.panels.get(f.alpha.id).bridge.paused, false);
  assert.equal(host.options.onPrivateInput('shared', 'Password', 'paused'), false);
  await assert.rejects(host.options.onEventRequest('shared', 'PaneClosing', {Cancel: false}), {name: 'InvalidStateError'});
  f.emit(f.beta, {event: 'state', state: 'running', output: '', frames: [], stats: {}});
  assert.equal(panel.host, host);
  assert.equal(panel.bridge.paused, false);
  assert.equal(host.options.onPrivateInput('shared', 'Password', 'resumed'), true);
  decision.resolve({Cancel: true});
  await settle();
  assert.deepEqual(f.errors, []);
});

test('browser host operations return through the owning session and session removal releases its host', async context => {
  const f = await fixture(context);
  const panel = f.windows.panels.get(f.beta.id), host = panel.host;
  f.emit(f.beta, {event: 'uiHostRequest', requestId: 'capture', kind: 'renderToBitmap', payload: {id: 'shared'}});
  await settle();
  const requests = f.beta.worker.worker.requests.filter(request => request.method === 'uiHostResponse');
  assert.equal(requests.length, 1);
  assert.deepEqual([...requests[0].params.result.pixels], [1, 2, 3, 255]);
  assert.equal(requests[0].params.sessionId, 1);
  assert.equal(f.alpha.worker.worker.requests.filter(request => request.method === 'uiHostResponse').length, 0);
  f.sessions.remove(f.beta.id);
  assert.equal(host.disposeCount, 1);
  assert.equal(panel.bridge.closed, true);
  assert.equal(panel.element.removed, true);
  assert.equal(f.windows.panels.has(f.beta.id), false);
  assert.equal(f.windows.panels.get(f.alpha.id).host.disposed, false);
  assert.deepEqual(f.errors, []);
});
