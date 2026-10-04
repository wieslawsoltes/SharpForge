import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppHostFixture as environment} from './a18-app-host-fixtures.js';

test('idle UI pause freezes managed input/layout and the animation clock while preserving actual terminated VM state', async () => {
  const env = environment();
  env.configuration.handler = (message, worker) => {
    if (message.method === 'launch') worker.state = 'terminated';
    return false;
  };
  const idle = await env.host.launch(), other = await env.host.launch();
  const paused = await env.host.pause(idle.sessionId, {generation: idle.generation});
  assert.equal(paused.state, 'paused');
  assert.equal(paused.runtimeState, 'terminated');
  assert.equal(paused.pauseKind, 'idle-ui');
  assert.equal(paused.pauseAcknowledged, true);
  assert.equal(env.host.list()[1].state, 'terminated');
  assert.deepEqual(env.workers[0].sent.filter(message => message.method === 'uiAnimationMode').map(message => message.params.manual), [true]);
  const descriptor = env.sessions.get(idle.sessionId);
  await assert.rejects(descriptor.request('uiEvent', {id: 'button', event: 'Click'}), {code: 'SFDA0015'});
  await assert.rejects(descriptor.request('uiAnimationAdvance', {milliseconds: 16}), {code: 'SFDA0015'});
  await assert.rejects(descriptor.request('uiAnimationMode', {manual: false}), {code: 'SFDA0015'});
  env.windows[0].options.onEvent('button', 'Click', {});
  env.windows[0].options.onLayout([{id: 'button', width: 200, height: 40}]);
  await Promise.resolve();
  assert.equal(env.workers[0].sent.some(message => message.method === 'uiEvent' || message.method === 'uiLayout'), false);
  env.windows[1].options.onEvent('button', 'Click', {});
  assert.equal(env.workers[1].sent.at(-1).method, 'uiEvent');
  const resumed = await env.host.resume(idle.sessionId, {generation: idle.generation});
  assert.equal(resumed.state, 'terminated');
  assert.equal(resumed.pauseKind, null);
  assert.equal(resumed.runtimeState, 'terminated');
  assert.deepEqual(env.workers[0].sent.filter(message => message.method === 'uiAnimationMode').map(message => message.params.manual), [true, false]);
  assert.equal(env.workers[0].sent.some(message => message.method === 'resume'), false, 'idle UI does not invent a suspended managed thread');
  assert.equal(env.workers[0].sent.some(message => message.method === 'uiLayout'), true);
  env.windows[0].options.onEvent('button', 'Click', {});
  assert.equal(env.workers[0].sent.at(-1).method, 'uiEvent');
  assert.equal(env.sessions.get(other.sessionId).pauseKind, null);
  env.host.dispose();
});

test('native running/waiting pause keeps the debugger route and idle resume restores a preexisting manual animation mode', async () => {
  const native = environment();
  const running = await native.host.launch();
  const paused = await native.host.pause(running.sessionId);
  assert.equal(paused.pauseKind, 'debugger');
  assert.equal(paused.runtimeState, 'paused');
  assert.equal(native.workers[0].sent.some(message => message.method === 'uiAnimationMode'), false);
  await native.host.resume(running.sessionId);
  assert.equal(native.workers[0].sent.at(-1).method, 'resume');
  native.host.dispose();
  const manual = environment({runtimeOptions: () => ({manualAnimations: true})});
  manual.configuration.handler = (message, worker) => {
    if (message.method === 'launch') worker.state = 'terminated';
    return false;
  };
  const idle = await manual.host.launch();
  await manual.host.pause(idle.sessionId);
  await manual.host.resume(idle.sessionId);
  assert.deepEqual(manual.workers[0].sent.filter(message => message.method === 'uiAnimationMode').map(message => message.params.manual), [true, true]);
  manual.host.dispose();
});

test('canceled idle pause remains explicitly unconfirmed until Continue and disposal never sends to a replacement generation', async () => {
  const env = environment();
  env.configuration.handler = (message, worker) => {
    if (message.method === 'launch') worker.state = 'terminated';
    return false;
  };
  const idle = await env.host.launch();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  env.workers[0].handler = message => {
    if (message.method !== 'uiAnimationMode') return false;
    entered();
    return true;
  };
  const controller = new AbortController();
  const pending = env.host.pause(idle.sessionId, {signal: controller.signal});
  await ready;
  await assert.rejects(env.host.resume(idle.sessionId), {code: 'SFDA0013'});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(env.host.list()[0].pauseAcknowledged, false);
  assert.equal(env.host.list()[0].state, 'paused');
  env.workers[0].handler = null;
  await env.host.resume(idle.sessionId);
  assert.equal(env.host.list()[0].pauseKind, null);
  const old = env.sessions.get(idle.sessionId);
  const replacement = await env.host.restart(idle.sessionId);
  const sent = env.workers[1].sent.length;
  await assert.rejects(old.request('resume'), {code: 'SFDA0002'});
  assert.equal(env.workers[1].sent.length, sent);
  assert.equal(env.host.list()[0].generation, replacement.generation);
  env.host.dispose();
});

test('a managed callback arriving during idle clock suspension is paused through the real debugger route', async () => {
  const env = environment();
  env.configuration.handler = (message, worker) => {
    if (message.method === 'launch') worker.state = 'terminated';
    if (message.method === 'uiAnimationMode' && message.params.manual) {
      worker.state = 'running';
      worker.reportState();
    }
    return false;
  };
  const idle = await env.host.launch();
  const paused = await env.host.pause(idle.sessionId);
  assert.equal(paused.runtimeState, 'paused');
  assert.equal(paused.pauseKind, 'debugger');
  assert.equal(env.workers[0].sent.filter(message => message.method === 'pause').length, 2);
  await env.host.resume(idle.sessionId);
  assert.equal(env.workers[0].sent.at(-1).method, 'resume');
  assert.equal(env.workers[0].sent.filter(message => message.method === 'uiAnimationMode').at(-1).params.manual, false);
  env.host.dispose();
});

test('stopping while idle pause is pending aborts its channel and releases the gated window', async () => {
  const env = environment();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  env.configuration.handler = (message, worker) => {
    if (message.method === 'launch') worker.state = 'terminated';
    if (message.method !== 'uiAnimationMode') return false;
    entered();
    return true;
  };
  const idle = await env.host.launch();
  const pending = env.host.pause(idle.sessionId);
  await ready;
  env.host.stop(idle.sessionId);
  await assert.rejects(pending, {code: 'SFDA0002'});
  assert.equal(env.windows[0].disposed, true);
  assert.equal(env.workers[0].terminated, true);
  assert.equal(env.sessions.entries.size, 0);
  assert.equal(env.host.list().length, 0);
  env.host.dispose();
});
