import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppHostFixture as environment} from './a18-app-host-fixtures.js';
import {contributeDesignerAppAutomation} from '../apps/studio/designer-app-host-automation.js';

test('parallel apps compile once each and keep worker ids, inputs, windows and selection independent', async () => {
  const env = environment();
  try {
    const first = await env.host.launch({uri: 'View.cs'}), second = await env.host.launch({debug: true});
    assert.notEqual(first.sessionId, second.sessionId);
    assert.equal(env.builds.length, 2);
    assert.equal(env.workers.length, 2);
    assert.equal(env.windows.every(window => window.shown), true);
    assert.equal(first.runtimeSessionId, 41);
    assert.equal(second.runtimeSessionId, 42);
    assert.equal(env.host.list().length, 2);
    const one = env.sessions.get(first.sessionId), two = env.sessions.get(second.sessionId);
    assert.notEqual(one.request, two.request);
    assert.equal((await one.request('designSnapshot', {sessionId: 41, sessionGeneration: 1})).worker, 1);
    assert.equal((await two.request('designSnapshot', {sessionId: 42, sessionGeneration: 1})).worker, 2);
    await env.host.pause(first.sessionId, {generation: first.generation});
    assert.equal(env.host.list()[0].state, 'paused');
    assert.equal(env.host.list()[1].state, 'waiting');
    env.windows[1].options.onEvent('button', 'Click', {value: 1});
    await Promise.resolve();
    const inputs = env.workers[1].sent.filter(message => message.method === 'uiEvent');
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].params.sessionId, 42);
    assert.equal(env.workers[0].sent.some(message => message.method === 'uiEvent'), false);
    env.windows[0].options.onSelect(['window']);
    assert.equal(env.sessions.selections[0].sessionId, first.sessionId);
    assert.deepEqual(two.selection, []);
    env.sessions.select(second.sessionId, second.generation, ['window']);
    assert.deepEqual(env.windows[1].selected, ['window']);
    assert.deepEqual(env.windows[0].selected, []);
  } finally { env.host.dispose(); }
  assert.equal(env.workers.every(worker => worker.terminated), true);
  assert.equal(env.windows.every(window => window.disposed), true);
  assert.equal(env.sessions.entries.size, 0);
});

test('no worker or window is created until compilation succeeds, and a pending launch reserves capacity', async () => {
  const env = environment({limit: 1});
  let complete, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  env.configuration.build = () => { entered(); return new Promise(resolve => { complete = resolve; }); };
  const pending = env.host.launch();
  await ready;
  assert.equal(env.workers.length, 0);
  assert.equal(env.windows.length, 0);
  await assert.rejects(env.host.launch(), {code: 'SFDA0006'});
  complete({success: false, diagnostics: [{code: 'CS1001'}]});
  await assert.rejects(pending, {code: 'SFDA0010'});
  assert.equal(env.workers.length, 0);
  assert.equal(env.host.operations.size, 0);
  env.host.dispose();
});

test('the hard eight-app limit and cancellation release reserved capacity', async () => {
  const env = environment();
  const apps = await Promise.all(Array.from({length: 8}, () => env.host.launch()));
  await assert.rejects(env.host.launch(), {code: 'SFDA0006'});
  assert.equal(env.workers.length, 8);
  env.host.stop(apps[0].sessionId);
  const controller = new AbortController();
  env.configuration.build = () => new Promise(() => {});
  const canceled = env.host.launch({signal: controller.signal});
  controller.abort();
  await assert.rejects(canceled, {name: 'AbortError'});
  assert.equal(env.host.operations.size, 0);
  assert.equal(env.host.list().length, 7);
  env.host.dispose();
});

test('restart keeps the external identity, increases generation and invalidates every old callback', async () => {
  const env = environment();
  const first = await env.host.launch();
  const old = env.sessions.get(first.sessionId), oldWindow = env.windows[0];
  const second = await env.host.restart(first.sessionId, {generation: first.generation});
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.generation, first.generation + 1);
  assert.equal(env.workers[0].terminated, true);
  assert.equal(oldWindow.disposed, true);
  assert.equal(env.sessions.get(first.sessionId).generation, second.generation);
  await assert.rejects(old.request('pause'), {code: 'SFDA0002'});
  const sent = env.workers[1].sent.length;
  oldWindow.options.onEvent('button', 'Click', {});
  env.workers[0].event('state', {state: 'faulted', uiActive: false});
  assert.equal(env.host.list()[0].state, 'waiting');
  assert.equal(env.workers[1].sent.length, sent);
  assert.equal(env.host.stop(first.sessionId, {generation: first.generation}), false);
  assert.equal(env.host.list().length, 1);
  await assert.rejects(env.sessions.get(first.sessionId).request('state', {sessionId: first.runtimeSessionId}), {code: 'SFDA0002'});
  await assert.rejects(env.sessions.get(first.sessionId).request('state', {sessionGeneration: first.generation}), {code: 'SFDA0002'});
  await assert.rejects(env.sessions.get(first.sessionId).request('launch'), {code: 'SFDA0003'});
  env.host.dispose();
});

test('failed compile or worker launch during restart leaves the old app alive and never reuses a generation', async () => {
  const env = environment();
  const first = await env.host.launch();
  const initialBuild = env.configuration.build;
  env.configuration.build = {success: false, diagnostics: []};
  await assert.rejects(env.host.restart(first.sessionId), {code: 'SFDA0010'});
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].terminated, false);
  env.configuration.build = initialBuild;
  env.configuration.handler = (message, worker) => {
    if (message.method !== 'launch') return false;
    worker.emit({id: message.id, error: {message: 'Bad assembly', code: 'BAD_ASSEMBLY'}});
    return true;
  };
  await assert.rejects(env.host.restart(first.sessionId), {code: 'BAD_ASSEMBLY'});
  assert.equal(env.workers[0].terminated, false);
  assert.equal(env.workers[1].terminated, true);
  assert.equal(env.windows[1].disposed, true);
  assert.equal(env.host.list()[0].generation, first.generation);
  env.configuration.handler = null;
  const replacement = await env.host.restart(first.sessionId);
  assert.equal(replacement.generation, 4);
  env.host.dispose();
});

test('source or workspace changes during compilation are discarded before a worker is created', async () => {
  const env = environment();
  env.configuration.build = () => {
    env.source.files[0].text = 'changed while compiling';
    return {success: true, assembly: new Uint8Array([1])};
  };
  await assert.rejects(env.host.launch(), {code: 'SFDA0012'});
  assert.equal(env.workers.length, 0);
  env.configuration.build = () => {
    env.source.workspace = 'Another:2';
    return {success: true, assembly: new Uint8Array([1])};
  };
  await assert.rejects(env.host.launch(), {code: 'SFDA0012'});
  assert.equal(env.windows.length, 0);
  env.host.dispose();
});

test('stopping during restart cancels the candidate and old app without publishing the replacement', async () => {
  const env = environment();
  const first = await env.host.launch();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  env.configuration.handler = (message, worker) => {
    if (message.method !== 'launch') return false;
    entered(worker);
    return true;
  };
  const restarting = env.host.restart(first.sessionId);
  await ready;
  env.host.stop(first.sessionId, {generation: first.generation});
  await assert.rejects(restarting, {code: 'SFDA0002'});
  assert.equal(env.host.list().length, 0);
  assert.equal(env.sessions.entries.size, 0);
  assert.equal(env.workers.every(worker => worker.terminated), true);
  assert.equal(env.windows.every(window => window.disposed), true);
  env.host.dispose();
});

test('owned source receipts and exact compilation output gate actual targeted Hot Reload requests', async () => {
  const env = environment();
  const first = await env.host.launch(), other = await env.host.launch();
  const app = env.sessions.get(first.sessionId), otherApp = env.sessions.get(other.sessionId);
  const before = env.source.files.map(file => ({...file}));
  app.assertSourceOwnership({uris: ['View.cs']});
  env.source.files[0].text = 'class View { int changed; }';
  app.authorizeSourceChanges({before, after: env.source.files});
  const identity = {sessionId: first.sessionId, generation: first.generation};
  const compiled = await app.compile(identity);
  await assert.rejects(otherApp.compile({sessionId: other.sessionId, generation: other.generation}), {code: 'SFDA0012'});
  await assert.rejects(app.request('hotReload', {image: {...compiled.image}, expectedVersion: 0}), {code: 'SFDA0012'});
  const applied = await app.request('hotReload', {image: compiled.image, expectedVersion: 0});
  assert.equal(applied.worker, 1);
  assert.equal(env.sessions.get(first.sessionId).codeVersion, 1);
  assert.equal(env.sessions.get(first.sessionId).sourceProjection[0].text, env.source.files[0].text);
  assert.equal(env.workers[1].sent.some(message => message.method === 'hotReload'), false);
  env.source.workspace = 'Other:2';
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0008'});
  await assert.rejects(env.host.restart(first.sessionId), {code: 'SFDA0008'});
  env.host.dispose();
});

test('fatal worker failure removes only that app and disposal cleans all apps even if one view cleanup fails', async () => {
  const env = environment();
  const first = await env.host.launch(), second = await env.host.launch();
  env.workers[0].dispatchEvent(new Event('error'));
  assert.equal(env.host.list().length, 1);
  assert.equal(env.sessions.get(first.sessionId), null);
  assert.equal(env.sessions.get(second.sessionId).uiActive, true);
  assert.equal(env.errors.length, 1);
  await env.host.launch();
  env.windows[1].dispose = () => { throw new Error('Failed view cleanup'); };
  assert.throws(() => env.host.dispose(), AggregateError);
  assert.equal(env.workers.every(worker => worker.terminated), true);
  assert.equal(env.sessions.entries.size, 0);
  assert.equal(env.windows[2].disposed, true);
  assert.equal(env.host.list().length, 0);
});

test('automation resolves the current host provider after workspace reset', async () => {
  const first = environment(), second = environment();
  let current = first.host, commands;
  contributeDesignerAppAutomation({contributeAutomation: (namespace, value) => {
    assert.equal(namespace, 'designerApps'); commands = value;
  }}, {host: () => current, sessions: first.sessions});
  await commands.launch();
  assert.equal(commands.list().length, 1);
  first.host.dispose();
  current = second.host;
  assert.equal(commands.list().length, 0);
  await commands.launch();
  assert.equal(second.host.list().length, 1);
  second.host.dispose();
});

test('workspace-scoped host prefixes prevent a stale identity from resolving a recreated host application', async () => {
  const first = environment({idPrefix: 'designer-app-epoch1'});
  const previous = await first.host.launch();
  const previousDescriptor = first.sessions.get(previous.sessionId);
  first.host.dispose();
  const second = environment({idPrefix: 'designer-app-epoch2', sessions: first.sessions});
  const current = await second.host.launch();
  assert.notEqual(previous.sessionId, current.sessionId);
  assert.equal(previous.generation, current.generation);
  await assert.rejects(previousDescriptor.request('pause'), {code: 'SFDA0002'});
  assert.equal(second.host.stop(previous.sessionId, {generation: previous.generation}), false);
  assert.equal(second.workers[0].sent.length, 1);
  assert.throws(() => second.host.resolve(previous.sessionId, previous.generation), {code: 'SFDA0002'});
  assert.equal(first.sessions.get(current.sessionId).uiActive, true);
  second.host.dispose();
  assert.throws(() => environment({idPrefix: 'bad prefix'}), /identity prefix/);
});

test('a workspace change while a worker starts disposes the unpublished candidate', async () => {
  const env = environment();
  env.configuration.handler = (message, worker) => {
    if (message.method !== 'launch') return false;
    env.source.workspace = 'Changed:2';
    worker.emit({id: message.id, result: {started: true, sessionId: worker.runtimeSessionId}});
    return true;
  };
  await assert.rejects(env.host.launch(), {code: 'SFDA0012'});
  assert.equal(env.host.list().length, 0);
  assert.equal(env.sessions.entries.size, 0);
  assert.equal(env.workers[0].terminated, true);
  assert.equal(env.windows[0].disposed, true);
  assert.equal(env.windows[0].shown, undefined);
  env.host.dispose();
});

test('foreign runtime events are ignored and startup events have a bounded queue', async () => {
  const env = environment();
  const app = await env.host.launch();
  env.workers[0].emit({event: 'state', sessionId: 999, state: 'faulted', uiActive: false});
  assert.equal(env.host.list()[0].state, 'waiting');
  env.configuration.handler = (message, worker) => {
    if (message.method !== 'launch') return false;
    for (let count = 0; count < 129; count++) worker.reportState();
    return true;
  };
  await assert.rejects(env.host.launch(), {code: 'SFDA0014'});
  assert.equal(env.workers[1].terminated, true);
  assert.equal(env.windows[1].disposed, true);
  assert.equal(env.host.list()[0].sessionId, app.sessionId);
  assert.equal(env.host.list().length, 1);
  env.host.dispose();
});

test('an interrupted code update cannot silently reuse a now-ambiguous compilation receipt', async () => {
  const env = environment();
  const launched = await env.host.launch();
  const descriptor = env.sessions.get(launched.sessionId);
  const compiled = await descriptor.compile({sessionId: launched.sessionId, generation: launched.generation});
  env.workers[0].handler = message => message.method === 'hotReload';
  const controller = new AbortController();
  const pending = descriptor.request('hotReload', {image: compiled.image, expectedVersion: 0}, {signal: controller.signal});
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.throws(() => descriptor.assertSourceOwnership(), {code: 'SFDA0011'});
  env.host.dispose();
});

