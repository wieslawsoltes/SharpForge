import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioUIHostBridge} from '../apps/studio/ui-host-bridge.js';
import {Compositor, CompositionTransport} from '@sharpforge/rendering';
import {AnimationClock} from '@sharpforge/framework';

class Host {
  constructor(root, options) {
    this.options = options;
    this.services = options.services;
    this.nodes = new Map([['element', {properties: {Opacity: 1}}]]);
    this.privateValues = new Map();
    this.compositionValues = new Map();
    this.brushes = new Map();
    this.previews = new Map();
    this.disposed = false;
  }
  apply(commands) { this.commands = commands; }
  scheduleRender() { this.renders = (this.renders ?? 0) + 1; }
  applyCompositionProperty(id, property, value) { this.compositionValues.set(id + ':' + property, value); }
  setElementComposition(id, value) { this.previews.set(id, value); }
  setCompositionBrush(id, property, brush) { this.brushes.set(id + ':' + property, brush); }
  setPrivateValue(id, property, value) { this.privateValues.set(id + ':' + property, value); }
  invoke(id, method, args) { return this.operation?.(id, method, args) ?? {handled: true, value: true}; }
  renderToBitmap() { return {width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255])}; }
  dispose() { this.disposed = true; }
}
function fixture() {
  const calls = [], errors = [], frames = new Map();
  let serial = 0;
  const bridge = new StudioUIHostBridge({classList: {toggle() {}}}, {
    sessionId: 1, createHost: (root, options) => new Host(root, options),
    request: (method, payload) => { calls.push({method, payload}); return Promise.resolve(); }, onError: error => errors.push(error),
    schedulerOptions: {requestFrame: callback => { frames.set(++serial, callback); return serial; }, cancelFrame: id => frames.delete(id)}
  });
  return {bridge, calls, errors, frames};
}

test('Studio forwards bounded environment snapshots with the current session and pauses feedback during debugging', () => {
  const {bridge, calls} = fixture();
  const snapshot = {version: 1, revision: 1, RasterizationScale: 1.5, AnimationsEnabled: false,
    Size: {Width: 320, Height: 568}, HighContrast: true, HighContrastScheme: 'Browser forced colors'};
  assert.equal(bridge.host.options.onEnvironmentSnapshot(snapshot), true);
  assert.equal(calls[0].method, 'uiEnvironmentSnapshot');
  assert.equal(calls[0].payload.sessionId, 1);
  assert.deepEqual(calls[0].payload.snapshot, snapshot);
  assert.throws(() => bridge.host.options.onEnvironmentSnapshot({...snapshot, RasterizationScale: NaN}));
  bridge.setPaused(true);
  assert.equal(bridge.host.options.onEnvironmentSnapshot(snapshot), false);
  assert.equal(calls.length, 1);
  bridge.dispose();
});

test('Studio UI channels preserve private values, routed args and one session identity', () => {
  const {bridge, calls, errors} = fixture();
  bridge.receive({event: 'uiPrivateValues', sessionId: 1, values: [{id: 'element', property: 'Password', value: 'private'}]});
  assert.equal(bridge.host.privateValues.get('element:Password'), 'private');
  assert.equal(bridge.host.nodes.get('element').properties.Password, undefined);
  const options = bridge.host.options;
  assert.equal(options.onCollectionInput('element', 'Items', ['a']), true);
  assert.equal(options.onRealizeItems({id: 'element', indices: [0, 3, 2047]}), true);
  assert.equal(options.onAutomationAction('element', 'Invoke', [], 'Invoke'), true);
  options.onPrivateInput('element', 'Password', 'changed');
  options.onRoutedEvent('element', 'Tapped', {Handled: false, Position: {X: 3, Y: 4}, Route: ['element']});
  options.onLayoutSnapshot({version: 1, revision: 2, scale: 1, nodes: []});
  assert.deepEqual(calls.map(call => call.method), ['uiCollectionInput', 'uiRealizeItems', 'uiAutomationAction',
    'uiPrivateInput', 'uiEvent', 'uiLayoutSnapshot']);
  assert.ok(calls.every(call => call.payload.sessionId === 1));
  assert.deepEqual(calls[1].payload.indices, [0, 3, 2047]);
  assert.deepEqual(calls[4].payload.payload.Route, ['element']);
  bridge.setPaused(true);
  assert.equal(options.onPrivateInput('element', 'Password', 'paused'), false);
  assert.equal(options.onRealizeItems({id: 'element', indices: [1]}), false);
  assert.equal(options.onAutomationAction('element', 'Invoke', [], 'Invoke'), false);
  assert.equal(calls.length, 6);
  assert.equal(errors.length, 0);
  bridge.dispose();
});

test('Studio bridge uses the shared host scheduler and freezes compositor clocks while paused', async () => {
  const {bridge, calls, frames} = fixture();
  const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
  const transport = new CompositionTransport({session: 'composition-one', enqueue: () => {},
    emit: packet => bridge.receive({event: 'uiComposition', sessionId: 1, packets: [structuredClone(packet)]})});
  transport.connect(compositor);
  const visual = compositor.CreateSpriteVisual();
  const animation = compositor.CreateScalarKeyFrameAnimation();
  animation.Duration = 100;
  animation.InsertKeyFrame(0, 0);
  animation.InsertKeyFrame(1, 1);
  visual.StartAnimation('Opacity', animation);
  transport.preview('element', {visual});
  const projected = bridge.host.previews.get('element').visual;
  bridge.scheduler.flush(0);
  bridge.scheduler.flush(25);
  assert.equal(projected.Opacity, 0.25);
  bridge.setPaused(true);
  bridge.scheduler.invalidate('build');
  bridge.scheduler.flush(2000);
  assert.equal(projected.Opacity, 0.25);
  assert.equal(frames.size, 0);
  bridge.setPaused(false);
  bridge.scheduler.flush(3000);
  bridge.scheduler.flush(3075);
  assert.equal(projected.Opacity, 1);
  assert.equal(calls.filter(call => call.method === 'uiCompositionCompleted').length, 1);
  assert.equal(bridge.host.options.services.scheduler, bridge.scheduler);
  const previous = bridge.host;
  bridge.setSession(2);
  assert.equal(previous.disposed, true);
  assert.equal(bridge.composition.sessions.size, 0);
  bridge.receive({event: 'uiPrivateValues', sessionId: 1, values: [{id: 'element', property: 'Password', value: 'stale'}]});
  assert.equal(bridge.host.privateValues.size, 0);
  bridge.dispose();
  await compositor.dispose();
});

test('host requests allow only typed operations and report asynchronous failures without stale responses', async () => {
  const {bridge, calls, errors} = fixture();
  await bridge.handleRequest({sessionId: 1, requestId: 'capture', kind: 'renderToBitmap', payload: {id: 'element'}});
  assert.deepEqual([...calls[0].payload.result.pixels], [255, 0, 0, 255]);
  await bridge.handleRequest({sessionId: 1, requestId: 'bad', kind: 'control', payload: {id: 'element', method: 'dispose', args: []}});
  assert.equal(calls[1].payload.error.name, 'TypeError');
  bridge.host.operation = () => Promise.reject(new Error('platform failed'));
  await bridge.handleRequest({sessionId: 1, requestId: 'async', kind: 'control', payload: {id: 'element', method: 'Focus', args: []}});
  assert.equal(calls[2].payload.error.message, 'platform failed');
  let resolve;
  bridge.host.operation = () => new Promise(done => { resolve = done; });
  const pending = bridge.handleRequest({sessionId: 1, requestId: 'pending', kind: 'control', payload: {id: 'element', method: 'Focus', args: []}});
  bridge.setSession(2);
  resolve(true);
  await pending;
  assert.equal(calls.length, 3);
  assert.equal(bridge.pending.size, 0);
  assert.equal(errors.length, 2);
  bridge.dispose();
});

test('file-drop requests pass only an opaque token and propagate session cancellation to the private broker', async () => {
  const {bridge, calls} = fixture();
  const received = [];
  bridge.host.input = {dragDrop: {files: {read(token, options) {
    received.push({token, signal: options.signal});
    return Promise.resolve([{id: 'storage-one', name: 'fixture.txt', contentType: 'text/plain', size: 4, lastModified: 0, isFile: true}]);
  }}}};
  await bridge.handleRequest({sessionId: 1, requestId: 'drop', kind: 'dropFiles', payload: {token: 'opaque_token_123456'}});
  assert.equal(received[0].token, 'opaque_token_123456');
  assert.ok(received[0].signal instanceof AbortSignal);
  assert.equal(calls[0].payload.result[0].name, 'fixture.txt');
  await bridge.handleRequest({sessionId: 1, requestId: 'forged', kind: 'dropFiles', payload: {token: '../file'}});
  assert.equal(calls[1].payload.error.name, 'TypeError');
  await bridge.handleRequest({sessionId: 1, requestId: 'bytes', kind: 'dropFiles', payload: {token: 'opaque_token_123456', bytes: [1]}});
  assert.equal(calls[2].payload.error.name, 'TypeError');
  assert.equal(received.length, 1);
  bridge.host.input.dragDrop.files.read = (token, options) => {
    received.push({token, signal: options.signal});
    return new Promise(() => {});
  };
  const pending = bridge.handleRequest({sessionId: 1, requestId: 'cancel', kind: 'dropFiles', payload: {token: 'opaque_token_123456'}});
  bridge.setSession(2);
  await pending;
  assert.equal(received[1].signal.aborted, true);
  assert.equal(calls.length, 3);
  bridge.dispose();
});
