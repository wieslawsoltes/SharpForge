import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioUIHostBridge} from '../apps/studio/ui-host-bridge.js';
import {RuntimeUIBridge, registerRuntimeUIHandlers} from '../apps/studio/workers/ui-bridge.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';

class Host {
  constructor(root, options) {
    this.options = options;
    this.nodes = new Map([['control', {properties: {}}]]);
    this.services = options.services;
  }
  scheduleRender() {}
  apply() {}
  applyCompositionProperty() {}
  setElementComposition() {}
  setCompositionBrush() {}
  dispose() { this.disposed = true; }
}

function fixture() {
  const decisions = [], errors = [], calls = [];
  const runtime = new RuntimeUIBridge({post() {}, wake() {}, onError: error => errors.push(error)});
  const vm = {state: 'terminated', platform: {ui: {reference: id => ({id}), requestEvent(receiver, event, payload, options) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    decisions.push({receiver, event, payload, signal: options.signal, resolve});
    return promise;
  }}}};
  runtime.attach(vm, 1);
  const handlers = createWorkerProtocol('runtime');
  registerRuntimeUIHandlers(handlers, {current: () => ({vm, bridge: runtime}), interactive() {},
    flush: () => runtime.flush(), schedule() {}});
  const studio = new StudioUIHostBridge({classList: {toggle() {}}}, {
    sessionId: 1, createHost: (root, options) => new Host(root, options), onError: error => errors.push(error),
    request: (method, params) => { calls.push({method, params}); return handlers.dispatch(method, params); },
    schedulerOptions: {requestFrame: () => 1, cancelFrame() {}}
  });
  return {studio, runtime, vm, decisions, errors, calls, dispose() { studio.dispose(); runtime.dispose(); handlers.dispose(); }};
}

test('the installed host callback reaches the managed decision RPC and returns the mutable outcome exactly once', async () => {
  const value = fixture();
  try {
    const result = value.studio.host.options.onEventRequest('control', 'BeforeTextChanging', {NewText: 'proposed', Cancel: false});
    assert.equal(value.decisions.length, 1);
    assert.equal(value.decisions[0].event, 'BeforeTextChanging');
    assert.deepEqual(value.decisions[0].payload, {NewText: 'proposed', Cancel: false});
    value.decisions[0].resolve({NewText: 'proposed', Cancel: true});
    assert.deepEqual(await result, {NewText: 'proposed', Cancel: true});
    assert.deepEqual(value.calls.map(call => call.method), ['uiEventRequest']);
    assert.equal(value.runtime.eventRequests.transactions.pending.size, 0);
    assert.equal(value.studio.eventRequests.transactions.pending.size, 0);
    assert.equal(value.errors.length, 0);
  } finally { value.dispose(); }
});

test('debug pause, scene reset and session replacement cancel held decisions on both sides', async () => {
  for (const action of ['pause', 'reset', 'session']) {
    const value = fixture();
    try {
      const result = value.studio.host.options.onEventRequest('control', 'RefreshRequested', {});
      const rejected = assert.rejects(result, /paused|changed/);
      if (action === 'pause') value.studio.setPaused(true);
      if (action === 'reset') value.studio.receive({event: 'ui', sessionId: 1, commands: [{op: 'reset', snapshot: {version: 1, nodes: []}}]});
      if (action === 'session') value.studio.setSession(2);
      await rejected;
      assert.equal(value.decisions[0].signal.aborted, true, action);
      value.decisions[0].resolve({Cancel: false});
      for (let index = 0; index < 8; index++) await Promise.resolve();
      assert.equal(value.runtime.eventRequests.transactions.pending.size, 0);
      assert.deepEqual(value.calls.map(call => call.method), ['uiEventRequest', 'uiEventCancel']);
      assert.equal(value.errors.length, 0);
    } finally { value.dispose(); }
  }
});
