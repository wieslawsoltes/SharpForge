import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionCapture, validateExecutionBatch} from '../apps/studio/workbench/tools/execution-capture.js';
import {DiagnosticTimeline} from '../apps/studio/workbench/tools/diagnostic-timeline-model.js';
import {drawDiagnosticGraph, drawEventTimeline, executionSummary} from '../apps/studio/workbench/tools/diagnostic-graphs.js';
import {executionMetric} from '../apps/studio/workers/execution-occupancy.js';

function batch({sessionId = 1, busyMs = 25, first = 1, sequence = 1, after = 0, active = false} = {}) {
  const samples = [];
  for (let index = Math.max(first, after + 1); index <= sequence; index++) samples.push({
    metric: executionMetric, sessionId, sequence: index, startMs: (index - 1) * 250, endMs: index * 250,
    durationMs: 250, busyMs, occupancyPercent: busyMs / 250 * 100, managedMs: busyMs, uiMs: 0, debuggerMs: 0
  });
  return {metric: executionMetric, sessionId, intervalMs: 250, active, sequence, firstSequence: first,
    truncated: first > after + 1, totalBusyMs: busyMs * sequence, samples};
}

function fixture(items = []) {
  const model = new DiagnosticTimeline({clock: () => 100});
  const listeners = new Set(), timers = new Map();
  let serial = 0;
  const sessions = {list: () => items, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }};
  const capture = new ExecutionCapture({sessions, model, clock: () => 100,
    setTimer: callback => { timers.set(++serial, callback); return serial; }, clearTimer: id => timers.delete(id)});
  return {capture, model, timers, listeners, items, dispose: () => { capture.dispose(); model.dispose(); }};
}

function session(id, response = batch()) {
  const requests = [];
  return {id, projectId: 'project:' + id, name: id, identity: id + ':1:1', runtimeSession: 1, worker: {generation: 1},
    live: false, requests, request: async (method, params) => { requests.push({method, params}); return response; }};
}

test('equal worker serials stay partitioned by app and launch identity', async () => {
  const alpha = session('alpha', batch({busyMs: 25})), beta = session('beta', batch({busyMs: 125}));
  const {capture, model, dispose} = fixture([alpha, beta]);
  await capture.poll();
  assert.equal(model.histories.get(alpha.identity).cpuSamples[0].occupancyPercent, 10);
  assert.equal(model.histories.get(beta.identity).cpuSamples[0].occupancyPercent, 50);
  assert.equal(model.histories.get(alpha.identity).runtimeSession, 1);
  assert.equal(model.histories.get(beta.identity).runtimeSession, 1);
  assert.deepEqual(alpha.requests[0], {method: 'executionMetrics', params: {identity: alpha.identity, after: 0, limit: 256}});
  await capture.poll();
  assert.equal(alpha.requests.length, 1, 'a completed launch is read once after catching up');
  alpha.identity = 'alpha:2:1';
  alpha.worker.generation = 2;
  await capture.poll();
  assert.equal(model.histories.size, 3);
  assert.equal(model.histories.get('alpha:1:1').cpuSamples.length, 1);
  assert.equal(model.histories.get('alpha:2:1').cpuSamples[0].sequence, 1);
  dispose();
});

test('strict capture validation rejects missing sequences, wrong identities and invalid measurements atomically', () => {
  const invalid = [
    value => { value.metric = 'cpu'; },
    value => { value.sessionId = 2; },
    value => { value.sequence = NaN; },
    value => { value.firstSequence = 2; },
    value => { value.truncated = true; },
    value => { value.samples = []; },
    value => { value.samples[0].sequence = 2; },
    value => { value.samples[0].sessionId = 9; },
    value => { value.samples[0].busyMs = Infinity; },
    value => { value.samples[0].managedMs = 99; },
    value => { value.samples[0].occupancyPercent = 50; },
    value => { value.samples[0].endMs = 251; },
    value => { value.totalBusyMs = 24; }
  ];
  for (const mutate of invalid) {
    const value = batch();
    mutate(value);
    assert.throws(() => validateExecutionBatch(value, {sessionId: 1}), {code: 'PROFILE_RESULT'});
  }
  assert.equal(validateExecutionBatch(batch(), {sessionId: 1}).samples.length, 1);
  const next = batch({sequence: 2, after: 1});
  assert.equal(validateExecutionBatch(next, {sessionId: 1, after: 1, previousEnd: 250}).samples.length, 1);
  assert.throws(() => validateExecutionBatch(next, {sessionId: 1, after: 1, previousEnd: 249}), {code: 'PROFILE_RESULT'});
  assert.throws(() => validateExecutionBatch(next, {sessionId: 1, after: 1, previousEnd: 251}), {code: 'PROFILE_RESULT'});
});

test('bounded history gaps are explicit and malformed replies block only their current launch', async () => {
  const alpha = session('alpha', batch({first: 10, sequence: 11})), beta = session('beta', {...batch(), samples: []});
  const {capture, model, dispose} = fixture([alpha, beta]);
  await capture.poll();
  assert.deepEqual(model.sessions.get('alpha').cpuSamples.map(sample => sample.sequence), [10, 11]);
  assert.equal(model.sessions.get('alpha').events[0].kind, 'execution-gap');
  assert.equal(model.sessions.get('beta').cpuSamples.length, 0);
  assert.match(model.sessions.get('beta').executionError, /omitted sequence/);
  await capture.poll();
  assert.equal(beta.requests.length, 1);
  beta.identity = 'beta:1:2';
  beta.runtimeSession = 2;
  beta.request = async () => batch({sessionId: 2});
  await capture.poll();
  assert.equal(model.sessions.get('beta').cpuSamples[0].sessionId, 2);
  assert.equal(model.histories.get('beta:1:1').cpuSamples.length, 0);
  dispose();
});

test('late replies after replacement cannot attach measurements to the replacement capture', async () => {
  let resolve;
  const alpha = session('alpha');
  alpha.request = () => new Promise(done => { resolve = done; });
  const {capture, model, dispose} = fixture([alpha]);
  const operation = capture.poll();
  alpha.identity = 'alpha:1:2';
  alpha.runtimeSession = 2;
  resolve(batch());
  await operation;
  assert.equal(model.histories.get('alpha:1:1').cpuSamples.length, 0);
  assert.equal(model.histories.has('alpha:1:2'), false);
  dispose();
});

test('pausing and disposal cancel outstanding waits without clearing retained launch history', async () => {
  let resolve;
  const alpha = session('alpha');
  alpha.request = () => new Promise(done => { resolve = done; });
  const {capture, model, timers, listeners, dispose} = fixture([alpha]);
  capture.start();
  assert.equal(listeners.size, 1);
  assert.equal(timers.size, 1);
  const pending = capture.poll();
  capture.setPaused(true);
  await pending;
  resolve(batch());
  await Promise.resolve();
  assert.equal(model.sessions.get('alpha').cpuSamples.length, 0);
  assert.equal(timers.size, 0);
  alpha.request = async () => batch();
  capture.setPaused(false);
  await capture.poll();
  assert.equal(model.sessions.get('alpha').cpuSamples.length, 1);
  capture.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(model.sessions.get('alpha').cpuSamples.length, 1);
  dispose();
});

test('disposed and removed sessions cannot create new capture work', async () => {
  const alpha = session('alpha');
  alpha.disposed = true;
  const {capture, model, items, dispose} = fixture([alpha]);
  await capture.poll();
  assert.equal(alpha.requests.length, 0);
  alpha.disposed = false;
  await capture.poll();
  items.length = 0;
  await capture.poll();
  assert.equal(capture.cursors.size, 0);
  assert.equal(model.histories.size, 1, 'completed bounded captures remain available after a session is removed');
  dispose();
});

test('timeline retains bounded descriptors and partitions heap snapshots by launch', async () => {
  const model = new DiagnosticTimeline({limit: 2, maxHistories: 2, clock: () => 100});
  const alpha = session('alpha');
  model.bind(alpha);
  const huge = 'x'.repeat(100_000);
  for (let index = 0; index < 3; index++) model.record('alpha', {event: 'output', text: huge,
    description: huge, stats: {heap: {liveBytes: index, liveObjects: 1}}}, {identity: alpha.identity});
  assert.equal(model.sessions.get('alpha').events.length, 2);
  assert.equal(model.sessions.get('alpha').events[0].description.length, 2048);
  assert.equal('text' in model.sessions.get('alpha').events[0], false);
  model.execution(alpha, batch({sequence: 3}));
  assert.deepEqual(model.sessions.get('alpha').cpuSamples.map(sample => sample.sequence), [2, 3]);
  let count = 0;
  alpha.request = async () => ({stamp: 'heap:' + ++count, objects: count, bytes: count * 16,
    types: [{kind: 'object', type: 'A', objects: count, bytes: count * 16}]});
  const before = await model.snapshot(alpha), after = await model.snapshot(alpha);
  assert.equal(after.stamp, 'heap:2');
  assert.deepEqual(model.diff(alpha.identity, before.id, after.id), {objects: 1, bytes: 16,
    types: [{kind: 'object', type: 'A', objects: 1, bytes: 16}]});
  alpha.identity = 'alpha:1:2';
  await model.snapshot(alpha);
  assert.throws(() => model.diff(alpha.identity, before.id, after.id), /same session launch/);
  model.bind(session('beta'));
  assert.equal(model.histories.size, 2);
  assert.equal(model.histories.has('alpha:1:1'), false);
  model.dispose();
});

test('heap snapshots reject late replacement and malformed census data', async () => {
  const model = new DiagnosticTimeline();
  const alpha = session('alpha');
  let resolve;
  alpha.request = () => new Promise(done => { resolve = done; });
  const pending = model.snapshot(alpha);
  alpha.identity = 'alpha:1:2';
  resolve({objects: 1, bytes: 16, types: []});
  await assert.rejects(pending, /launch changed/);
  alpha.request = async () => ({objects: 1, bytes: NaN, types: []});
  await assert.rejects(model.snapshot(alpha), /invalid/);
  alpha.request = async () => ({objects: 1, bytes: 16, types: [{type: 'A', objects: -1, bytes: 16}]});
  await assert.rejects(model.snapshot(alpha), /invalid/);
  assert.equal(model.histories.size, 0);
  model.dispose();
});

test('CPU graph uses actual time, bounded percent and weighted intervals with accessible event detail', () => {
  const summary = executionSummary([{durationMs: 10, busyMs: 10, occupancyPercent: 100},
    {durationMs: 90, busyMs: 0, occupancyPercent: 0}]);
  assert.equal(summary.mean, 10);
  const commands = [], attributes = {};
  const context = Object.fromEntries(['scale', 'clearRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map(name =>
    [name, (...args) => commands.push([name, ...args])]));
  const canvas = {getContext: () => context, clientWidth: 600, setAttribute: (name, value) => { attributes[name] = value; }};
  const samples = batch({sequence: 3}).samples.filter(sample => sample.sequence !== 2).map(sample => ({...sample, timestamp: sample.endMs}));
  assert.equal(drawDiagnosticGraph(canvas, samples, 'occupancyPercent'), true);
  assert.equal(commands.filter(command => command[0] === 'moveTo').length, 2, 'lost sequence intervals must not be connected');
  assert.equal(commands.filter(command => command[0] === 'lineTo').length, 2, 'each actual measured interval is visible');
  assert.match(attributes['aria-label'], /Worker execution occupancy: 2 samples/);
  assert.match(attributes['aria-label'], /0\.00 to 0\.75 seconds/u);
  commands.length = 0;
  assert.equal(drawDiagnosticGraph(canvas, [samples[0]], 'occupancyPercent'), true);
  assert.deepEqual(commands.filter(command => ['moveTo', 'lineTo'].includes(command[0])).map(command => command.slice(0, 2)),
    [['moveTo', 44], ['lineTo', 592]], 'a short-lived app still draws its single final interval');
  assert.equal(drawEventTimeline(canvas, [{timestamp: 1}, {timestamp: 5}]), true);
  assert.match(attributes['aria-label'], /event table provides each time and description/);
});
