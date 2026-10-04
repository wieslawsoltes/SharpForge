import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FrameScheduler} from '@sharpforge/rendering';
import {RuntimeUIFrames} from '../apps/studio/workers/ui-frames.js';
import {HostUIFrameRequests} from '../apps/studio/ui-frame-requests.js';
import {StudioUIHostBridge} from '../apps/studio/ui-host-bridge.js';
import {compileProgram} from './a19-runtime-programs.js';
import {studioRuntimeSession} from './helpers/studio-runtime-session.js';
import {inspectorDocument} from './support/a19-inspector-fixture.js';
import {deferred, settle} from './a19-session-fixtures.js';

test('worker frame queues coalesce owners, bound delivery, retain pause work and ignore cancelled acknowledgements', async () => {
  const requests = [], work = [], values = [], errors = [];
  const vm = {state: 'running', platform: {ui: {scheduleUI: callback => work.push(callback)}}};
  const bridge = {vm, closed: false, onError: error => errors.push(error), request(kind, payload, {signal}) {
    const request = {...deferred(), kind, payload, signal}; requests.push(request); return request.promise;
  }};
  const frames = new RuntimeUIFrames(bridge, {maximum: 3, perFrame: 2});
  const first = frames.requestFrame(time => values.push(['first', time]));
  frames.requestFrame(time => values.push(['second', time]));
  frames.requestFrame(time => values.push(['third', time]));
  assert.equal(requests.length, 1);
  assert.deepEqual([requests[0].kind, requests[0].payload], ['bindingFrame', {version: 1}]);
  assert.throws(() => frames.requestFrame(() => {}), /limit/);
  assert.equal(frames.cancelFrame(first), true);
  vm.state = 'paused'; frames.observe();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({version: 1, frame: 1, time: 8}); await settle();
  assert.equal(work.length, 0);
  vm.state = 'running'; frames.observe();
  requests[1].resolve({version: 1, frame: 2, time: 16}); await settle();
  assert.deepEqual(values, [], 'The host reply queues dispatcher work instead of running managed callbacks inline');
  work.shift()();
  assert.deepEqual(values, [['second', 16], ['third', 16]]);
  frames.requestFrame(() => assert.fail('Disposed callback was invoked'));
  frames.dispose(); requests[2].resolve({version: 1, frame: 3, time: 24}); await settle();
  assert.equal(frames.callbacks.size, 0);
  assert.deepEqual(errors, []);
});

test('host frame requests wait for a real scheduler tick and detach on abort, pause and disposal', async () => {
  const scheduled = new Map(); let id = 0, paused = true;
  const scheduler = new FrameScheduler({requestFrame: callback => { scheduled.set(++id, callback); return id; },
    cancelFrame: token => scheduled.delete(token)});
  const frames = new HostUIFrameRequests(scheduler, {isPaused: () => paused});
  const pending = frames.request({version: 1});
  assert.equal(scheduled.size, 0);
  paused = false; frames.resumed();
  const [token, callback] = scheduled.entries().next().value; scheduled.delete(token); callback(25);
  assert.deepEqual(await pending, {version: 1, frame: 1, time: 25});
  assert.equal(scheduler.callbacks[0].size, 0);
  const controller = new AbortController(), aborted = frames.request({version: 1}, {signal: controller.signal});
  controller.abort(); await assert.rejects(aborted, {name: 'AbortError'});
  const stopped = frames.request({version: 1}); frames.dispose();
  await assert.rejects(stopped, {name: 'AbortError'});
  assert.equal(scheduler.callbacks[0].size, 0);
  await assert.rejects(frames.request({version: 1, callback: 'forbidden'}), /Invalid/);
  scheduler.dispose();
});

class HostBoundary {
  constructor(root, options) { Object.assign(this, {root, options, services: options.services, nodes: new Map()}); }
  apply(commands) {
    for (const command of commands) {
      if (command.op === 'reset') this.nodes.clear();
      if (command.op === 'create') this.nodes.set(command.id, command);
    }
  }
  scheduleRender() {}
  applyCompositionProperty() {}
  setElementComposition() {}
  setCompositionBrush() {}
  dispose() { this.nodes.clear(); }
}
const source = readFileSync(new URL('./fixtures/bindings/phased-page.cs', import.meta.url), 'utf8');
let compiled;
const program = () => compiled ??= compileProgram(source);
const engines = {source: built => ({image: built.image, bindingAssembly: built.assembly}),
  reload: built => ({assembly: built.assembly}), CIL: built => ({assembly: built.assembly, managedIL: true})};

for (const [engine, executable] of Object.entries(engines)) {
  test(engine + ': actual worker x:Phase bindings advance across host frames, pause safely, and x:Load realizes only on FindName', async context => {
    const fixture = studioRuntimeSession(context), document = inspectorDocument(), scheduled = new Map(), errors = [];
    let next = 0;
    const bridge = new StudioUIHostBridge(document.createElement('div'), {request: (method, params) => fixture.session.request(method, params),
      createHost: (root, options) => new HostBoundary(root, options), onError: error => errors.push(error),
      schedulerOptions: {requestFrame: callback => { scheduled.set(++next, callback); return next; }, cancelFrame: token => scheduled.delete(token)}});
    const unsubscribe = fixture.session.subscribe(value => {
      if (value.type === 'ui' || value.type === 'uiHost') bridge.receive(value.event);
      if (value.type === 'state') bridge.setPaused(fixture.session.state === 'paused' || !fixture.session.live);
      if (value.type === 'ended' || value.type === 'starting') bridge.cancelPending();
    });
    context.after(() => { unsubscribe(); bridge.dispose(); });
    const options = {...executable(program()), debug: false, manualAnimations: true};
    await fixture.session.launch(options);
    const serial = fixture.session.runtimeSession;
    const state = await fixture.wait(value => value.event === 'state' && value.sessionId === serial
      && ['terminated', 'faulted'].includes(value.state));
    assert.equal(state.state, 'terminated', JSON.stringify(state.fault));
    assert.equal(state.output, 'ready\n');
    const first = await fixture.wait(value => value.event === 'uiHostRequest' && value.sessionId === serial && value.kind === 'bindingFrame');
    const scene = () => fixture.session.request('uiScene');
    const initial = await scene(), names = new Map(initial.nodes.map(node => [node.properties.Name, node.id]));
    assert.ok(names.has('phase1') && names.has('phase2') && names.has('phase3'));
    assert.equal(names.has('deferred'), false);
    assert.ok(initial.nodes.filter(node => /^phase[123]$/.test(node.properties.Name)).every(node => !node.properties.Text));
    const tick = () => {
      assert.ok(bridge.frames.pending.size > 0, 'The worker must await the shared host frame capability');
      const [token, callback] = scheduled.entries().next().value;
      scheduled.delete(token); callback(performance.now());
    };
    const changed = phase => fixture.wait(value => value.event === 'ui' && value.sessionId === serial && value.commands.some(command =>
      command.op === 'set' && command.id === names.get('phase' + phase) && command.property === 'Text' && command.value === 'PhaseRoot'));
    tick(); await changed(1);
    const second = await fixture.wait(value => value.event === 'uiHostRequest' && value.kind === 'bindingFrame' && value.requestId > first.requestId);
    await fixture.session.request('pause');
    assert.equal(fixture.session.state, 'paused');
    assert.equal(bridge.frames.pending.size, 0);
    assert.equal((await scene()).nodes.find(node => node.id === names.get('phase2')).properties.Text ?? '', '');
    await fixture.session.request('resume', {mode: 'continue'});
    const resumed = await fixture.wait(value => value.event === 'uiHostRequest' && value.kind === 'bindingFrame' && value.requestId > second.requestId);
    tick(); await changed(2);
    await fixture.wait(value => value.event === 'uiHostRequest' && value.kind === 'bindingFrame' && value.requestId > resumed.requestId);
    tick(); await changed(3);
    const complete = await scene();
    assert.ok(complete.nodes.filter(node => /^phase[123]$/.test(node.properties.Name)).every(node => node.properties.Text === 'PhaseRoot'));
    assert.equal(complete.nodes.some(node => node.properties.Name === 'deferred'), false);
    await fixture.session.request('uiEvent', {id: names.get('realize'), event: 'Click', payload: {}});
    await fixture.wait(value => value.event === 'output' && value.sessionId === serial && value.text.includes('deferred\n'));
    assert.ok((await scene()).nodes.some(node => node.properties.Name === 'deferred' && node.properties.Text === 'realized later'));
    await fixture.session.stop();
    assert.equal(bridge.frames.pending.size, 0);
    assert.deepEqual([...fixture.errors, ...errors], []);
  });
}
