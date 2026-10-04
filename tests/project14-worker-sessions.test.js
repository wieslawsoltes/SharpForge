import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {RuntimeUIBridge, registerRuntimeUIHandlers} from '../apps/studio/workers/ui-bridge.js';
import {RuntimeSessionFactory} from '../apps/studio/workers/runtime-session.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';

const compile = source => {
  const program = compileToIL(source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
};

test('a rejected replacement session cannot stop the active runtime or publish candidate output', () => {
  const factory = new RuntimeSessionFactory(), activeOutput = [], candidateOutput = [];
  const activeProgram = compile('using System; Console.WriteLine("active");');
  const active = factory.create({image: activeProgram.image, debug: false}, {onOutput: value => activeOutput.push(value)});
  const candidateProgram = compile('using System; Console.WriteLine("candidate");');
  assert.throws(() => factory.create({assembly: candidateProgram.assembly, managedIL: true,
    runToCursor: {uri: 'Program.cs', line: 1, column: 1}}, {onOutput: value => candidateOutput.push(value)}), /run-to-instruction/);
  try {
    const result = active.vm.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(activeOutput.join(''), 'active\n');
    assert.equal(candidateOutput.join(''), '');
  } finally { active.stop(); }
});

test('UI sessions separate public commands from secrets and discard output from disposed candidates', async () => {
  const messages = [], wakes = [];
  const active = new RuntimeUIBridge({post: message => messages.push(message), wake: bridge => wakes.push(bridge)});
  const candidate = new RuntimeUIBridge({post: message => messages.push(message), wake: bridge => wakes.push(bridge)});
  const options = active.runtimeOptions();
  options.onUICommand({op: 'set', id: '1:1', property: 'Text', value: 'public'});
  options.onPrivateUIValue('2:1', 'Password', 'private');
  candidate.runtimeOptions().onUICommand({op: 'create', id: '3:1'});
  candidate.dispose();
  active.attach({}, 8);
  await Promise.resolve();
  assert.deepEqual(messages.map(message => message.event), ['ui', 'uiPrivateValues']);
  assert(messages.every(message => message.sessionId === 8));
  assert.equal(JSON.stringify(messages[0]).includes('private'), false);
  assert.equal(messages[1].values[0].value, 'private');
  const previous = wakes.length;
  options.onExternalComplete();
  assert.equal(wakes.length, previous + 1, 'external completion restarts instruction pumping after all conversion continuations');
  active.dispose();
});

test('host result validation leaves requests recoverable and cancellation does not cross session ownership', async () => {
  const messages = [];
  const bridge = new RuntimeUIBridge({post: message => messages.push(message), wake() {}});
  bridge.attach({}, 1);
  const request = bridge.request('clipboard', {method: 'GetContent', args: []});
  bridge.flush();
  const requestId = messages.find(message => message.event === 'uiHostRequest').requestId;
  assert.throws(() => bridge.respond({requestId, result: {get unexpected() { throw new Error('must not execute'); }}}), /Invalid UI host data/);
  assert.equal(bridge.pending.size, 1);
  assert.equal(bridge.respond({requestId, result: {ok: true, data: {version: 1, values: [['Text', 'hello']]}}}), true);
  assert.equal((await request).data.values[0][1], 'hello');
  assert.equal(bridge.respond({requestId, result: 'duplicate'}), false);
  const pending = bridge.request('control', {id: '1:1', method: 'ShowAsync', args: []});
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  bridge.dispose();
  await rejected;
});

test('worker realization commands reject oversized indices and dispatch automation through the operation allowlist', () => {
  const handlers = createWorkerProtocol('runtime'), realized = [], automation = [];
  let paused = false;
  const context = {reference: id => ({id}), realizeItemIndices: (owner, indices) => realized.push({owner, indices}),
    services: {automation: {tree: {invoke: (...args) => automation.push(args)}}}};
  registerRuntimeUIHandlers(handlers, {current: () => ({vm: {platform: {ui: context}}}), flush() {}, schedule() {},
    interactive() { if (paused) throw new Error('paused'); }});
  assert.equal(handlers.dispatch('uiRealizeItems', {id: '4:1', indices: [0, 2, 100000]}), true);
  assert.equal(realized.length, 1);
  assert.throws(() => handlers.dispatch('uiRealizeItems', {id: '4:1', indices: [-1]}), /realization/);
  assert.throws(() => handlers.dispatch('uiRealizeItems', {id: '4:1', indices: Array(2049).fill(0)}), /realization/);
  assert.equal(handlers.dispatch('uiAutomationAction', {id: '4:1', method: 'Invoke', args: [], pattern: 0}), true);
  assert.deepEqual(automation, [['4:1', 'Invoke', [], 0]]);
  paused = true;
  assert.throws(() => handlers.dispatch('uiRealizeItems', {id: '4:1', indices: [1]}), /paused/);
  assert.equal(realized.length, 1);
});
