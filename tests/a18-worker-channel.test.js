import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {DesignerWorkerChannel} from '../apps/studio/designer-worker-channel.js';
import {DesignerAppWorkerChannel} from '../apps/studio/designer-app-host-channel.js';

class WorkerPort extends EventTarget {
  constructor() { super(); this.sent = []; this.terminated = false; }
  postMessage(value) { this.sent.push(structuredClone(value)); }
  terminate() { this.terminated = true; }
  reply(value) { this.dispatchEvent(new MessageEvent('message', {data: structuredClone(value)})); }
}

test('compiler cancellation uses envelope identity, releases listeners and keeps other requests alive', async context => {
  const worker = new WorkerPort(), channel = new DesignerWorkerChannel(worker);
  context.after(() => channel.dispose());
  const controller = new AbortController();
  const params = {uri: 'View.cs', generation: 8};
  const canceled = channel.request('designAnalyze', params, {signal: controller.signal});
  const unaffected = channel.request('build', {revision: 9});
  const expected = assert.rejects(canceled, error => error === controller.signal.reason);
  controller.abort(new DOMException('New edit', 'AbortError'));
  await expected;
  assert.deepEqual(worker.sent, [
    {id: 1, method: 'designAnalyze', params}, {id: 2, method: 'build', params: {revision: 9}},
    {method: 'cancelRequest', params: {requestId: 1}}
  ]);
  assert.deepEqual(params, {uri: 'View.cs', generation: 8}, 'transport identity never enters feature params');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(worker.terminated, false);
  worker.reply({id: 1, result: 'stale'});
  worker.reply({id: 2, result: 'built'});
  assert.equal(await unaffected, 'built');
  assert.equal(channel.pending.size, 0);
  assert.throws(() => channel.request('build', {}, {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(worker.sent.length, 3);
});

test('runtime and app aborts only cancel caller waits and preserve runtime event identity', async context => {
  for (const app of [false, true]) {
    const worker = new WorkerPort(), events = [];
    const options = {kind: 'runtime', onEvent: event => events.push(event)};
    const channel = app ? new DesignerAppWorkerChannel(worker, options) : new DesignerWorkerChannel(worker, options);
    context.after(() => channel.dispose());
    const controller = new AbortController();
    const pending = channel.request('applyDesign', {sessionId: 37}, {signal: controller.signal});
    const expected = assert.rejects(pending, {name: 'AbortError'});
    controller.abort();
    await expected;
    assert.equal(worker.sent.length, 1, 'runtime has no compiler cancellation method');
    worker.reply({event: 'state', sessionId: 37, state: 'paused'});
    assert.deepEqual(events, [{event: 'state', sessionId: 37, state: 'paused'}]);
    assert.equal(worker.terminated, false);
    await assert.rejects(channel.request('cancelRequest', {requestId: 1}), {code: app ? 'SFDA0003' : 'SFDW0003'});
  }
});

test('deadlines cancel queued compiler work and pending limits allocate no extra requests', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const worker = new WorkerPort(), channel = new DesignerWorkerChannel(worker, {timeout: 100, maxPending: 1});
  context.after(() => channel.dispose());
  const controller = new AbortController();
  const pending = channel.request('designAnalyze', {}, {signal: controller.signal});
  const expected = assert.rejects(pending, {code: 'SFDW0004'});
  await assert.rejects(channel.request('build'), {code: 'SFDW0006'});
  context.mock.timers.tick(100);
  await expected;
  assert.deepEqual(worker.sent[1], {method: 'cancelRequest', params: {requestId: 1}});
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(channel.pending.size, 0);
  assert.equal(worker.terminated, false);
});

test('remote compiler and app errors retain precise diagnostics without prototype changes', async context => {
  const details = {diagnostics: [{code: 'SFSYNC_COMPILE', uri: 'View.cs', span: {start: 17, length: 4}, severity: 'error'}],
    span: {start: 17, length: 4}, uri: 'View.cs', details: {expectedRevision: 1, actualRevision: 2}};
  for (const create of [worker => new DesignerWorkerChannel(worker), worker => new DesignerAppWorkerChannel(worker)]) {
    const worker = new WorkerPort(), channel = create(worker);
    context.after(() => channel.dispose());
    const pending = channel.request(channel.kind === 'compiler' ? 'validateDesigner' : 'applyDesign');
    const error = {...details, name: 'SourceError', message: 'Source changed', code: 'SFSYNC_COMPILE'};
    Object.defineProperty(error, '__proto__', {value: {polluted: true}, enumerable: true});
    worker.reply({id: 1, error});
    await assert.rejects(pending, value => {
      assert.ok(value instanceof Error);
      assert.equal(value.name, 'SourceError');
      assert.equal(value.code, 'SFSYNC_COMPILE');
      assert.deepEqual(value.diagnostics, details.diagnostics);
      assert.deepEqual(value.span, details.span);
      assert.deepEqual(value.details, details.details);
      assert.equal(value.polluted, undefined);
      return true;
    });
    const generic = channel.request(channel.kind === 'compiler' ? 'analyze' : 'state');
    worker.reply({id: 2, error: {name: 'Error', message: 'Unknown failure', code: undefined}});
    await assert.rejects(generic, {code: channel.kind === 'compiler' ? 'SFDW0005' : 'SFDA0005'});
  }
});

test('invalid inputs, clone failures, fatal failure and disposal leave no outstanding timers or listeners', async context => {
  const worker = new WorkerPort(), failures = [], controller = new AbortController();
  const channel = new DesignerWorkerChannel(worker, {onFailure: error => failures.push(error)});
  context.after(() => channel.dispose());
  assert.throws(() => new DesignerWorkerChannel(worker, {maxPending: 513}), RangeError);
  await assert.rejects(channel.request('build', []), TypeError);
  const uncloneable = channel.request('analyze', {callback() {}});
  await assert.rejects(uncloneable, {name: 'DataCloneError'});
  assert.equal(channel.pending.size, 0);
  const pending = channel.request('build', {}, {signal: controller.signal});
  const expected = assert.rejects(pending, {code: 'SFDW0005'});
  worker.dispatchEvent(new Event('messageerror'));
  await expected;
  assert.equal(failures.length, 1);
  assert.equal(worker.terminated, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(worker, 'message').length, 0);
  await assert.rejects(channel.request('build'), {code: 'SFDW0002'});
});
