import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAppCompilationUris, captureAppSources} from '../apps/studio/designer-app-host-source.js';
import {createAppHostFixture} from './a18-app-host-fixtures.js';

function twoProjects() {
  const environment = createAppHostFixture();
  environment.source.files = [
    {uri: 'AppA/View.cs', text: 'class ViewA {}'},
    {uri: 'AppA/Events.cs', text: 'class EventsA {}'},
    {uri: 'AppB/View.cs', text: 'class ViewB {}'}
  ];
  environment.configuration.build.compilationUris = ['AppA/View.cs', 'AppA/Events.cs'];
  return environment;
}

test('compilation membership is immutable, exact, bounded and never inferred from workspace sources', () => {
  const projection = captureAppSources([{uri: 'View.cs', text: 'A'}, {uri: 'view.cs', text: 'B'}]);
  const uris = ['view.cs', 'View.cs'];
  const captured = captureAppCompilationUris(uris, projection);
  uris.pop();
  assert.deepEqual(captured, ['View.cs', 'view.cs']);
  assert.ok(Object.isFrozen(captured));
  assert.equal(captureAppCompilationUris(undefined, projection), null);
  assert.equal(captureAppCompilationUris([], projection), null);
  for (const invalid of ['View.cs', ['View.cs', 'View.cs'], ['VIEW.cs'], ['bad\0uri'], new Array(1001)]) {
    assert.throws(() => captureAppCompilationUris(invalid, projection), {code: 'SFDA0012'});
  }
});

test('a full workspace receipt does not authorize writes to a different project', async () => {
  const environment = twoProjects();
  const launched = await environment.host.launch({uri: 'AppA/View.cs'});
  const app = environment.sessions.get(launched.sessionId);
  const before = captureAppSources(environment.source.files);
  assert.equal(app.sourceProjection.length, 3, 'freshness receipt retains the complete workspace');
  assert.deepEqual(app.compilationUris, ['AppA/Events.cs', 'AppA/View.cs']);
  environment.configuration.build.compilationUris.push('AppB/View.cs');
  let writes = 0;
  const write = uri => {
    app.assertSourceOwnership({uris: [uri]});
    writes++;
    environment.source.files.find(file => file.uri === uri).text = 'unexpected write';
  };
  assert.throws(() => write('AppB/View.cs'), {code: 'SFDA0012'});
  assert.equal(writes, 0);
  assert.deepEqual(captureAppSources(environment.source.files), before);
  assert.equal(environment.builds.length, 1);
  assert.ok(app.assertSourceOwnership({uris: ['AppA/Events.cs', 'AppA/View.cs']}));
  environment.host.dispose();
});

test('actual changed URIs in a receipt must all belong to the pinned compilation', async () => {
  const environment = twoProjects();
  const launched = await environment.host.launch({uri: 'AppA/View.cs'});
  const app = environment.sessions.get(launched.sessionId);
  const before = captureAppSources(environment.source.files);
  environment.source.files[2].text = 'unrelated project changed';
  assert.throws(() => app.authorizeSourceChanges({before, after: environment.source.files}), {code: 'SFDA0012'});
  await assert.rejects(app.compile(launched), {code: 'SFDA0012'});
  assert.equal(environment.builds.length, 1);
  assert.deepEqual(app.sourceProjection, before);
  environment.host.dispose();
});

test('owned partial files update together while full workspace freshness remains required', async () => {
  const environment = twoProjects();
  const launched = await environment.host.launch({uri: 'AppA/View.cs'});
  const app = environment.sessions.get(launched.sessionId);
  const before = captureAppSources(environment.source.files);
  environment.source.files[0].text = 'class ViewA { int changed; }';
  environment.source.files[1].text = 'class EventsA { int changed; }';
  app.authorizeSourceChanges({before, after: environment.source.files});
  environment.configuration.build.compilationUris.reverse();
  const result = await app.compile(launched);
  await app.request('hotReload', {image: result.image, expectedVersion: 0});
  const updated = environment.sessions.get(launched.sessionId);
  assert.deepEqual(updated.sourceProjection, captureAppSources(environment.source.files));
  assert.deepEqual(updated.compilationUris, ['AppA/Events.cs', 'AppA/View.cs']);
  assert.equal(environment.workers[0].sent.filter(message => message.method === 'hotReload').length, 1);
  environment.source.files[2].text = 'later unrelated workspace edit';
  assert.throws(() => updated.assertSourceOwnership({uris: ['AppA/View.cs']}), {code: 'SFDA0012'});
  environment.host.dispose();
});

test('new or removed compilation files cannot be adopted by a source receipt', async () => {
  for (const change of ['add', 'remove']) {
    const environment = twoProjects();
    const launched = await environment.host.launch({uri: 'AppA/View.cs'});
    const app = environment.sessions.get(launched.sessionId);
    const before = captureAppSources(environment.source.files);
    if (change === 'add') environment.source.files.push({uri: 'AppA/New.Events.cs', text: 'class NewEvents {}'});
    else environment.source.files.splice(1, 1);
    assert.throws(() => app.authorizeSourceChanges({before, after: environment.source.files}), {code: 'SFDA0012'});
    assert.deepEqual(app.sourceProjection, before);
    environment.host.dispose();
  }
});

test('a changed, absent or cross-project compilation input set is discarded before worker Hot Reload', async () => {
  for (const compilationUris of [undefined, ['AppA/View.cs'], ['AppB/View.cs'], ['AppA/View.cs', 'AppA/Events.cs', 'AppB/View.cs']]) {
    const environment = twoProjects();
    const launched = await environment.host.launch({uri: 'AppA/View.cs'});
    const app = environment.sessions.get(launched.sessionId);
    let complete, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    environment.configuration.build = () => {
      entered();
      return new Promise(resolve => { complete = resolve; });
    };
    const pending = app.compile(launched);
    await ready;
    const result = {success: true, image: {entryPoint: 2}, compilationUris};
    complete(result);
    await assert.rejects(pending, {code: 'SFDA0012'});
    await assert.rejects(app.request('hotReload', {image: result.image, expectedVersion: 0}), {code: 'SFDA0012'});
    assert.equal(environment.workers[0].sent.some(message => message.method === 'hotReload'), false);
    assert.deepEqual(app.compilationUris, ['AppA/Events.cs', 'AppA/View.cs']);
    environment.host.dispose();
  }
});

test('missing compilation evidence permits running and inspection but prevents source edits and code updates', async () => {
  const environment = twoProjects();
  delete environment.configuration.build.compilationUris;
  const launched = await environment.host.launch({uri: 'AppA/View.cs'});
  const app = environment.sessions.get(launched.sessionId);
  assert.equal(app.uiActive, true);
  assert.equal(app.compilationUris, null);
  assert.throws(() => app.assertSourceOwnership({uris: ['AppA/View.cs']}), {code: 'SFDA0012'});
  await assert.rejects(app.compile(launched), {code: 'SFDA0012'});
  assert.equal(environment.builds.length, 1);
  await app.request('pause');
  await app.request('resume');
  environment.host.dispose();
});

test('invalid compilation evidence is rejected before creating a worker or a window', async () => {
  const environment = twoProjects();
  environment.configuration.build.compilationUris = ['Missing.cs'];
  await assert.rejects(environment.host.launch({uri: 'AppA/View.cs'}), {code: 'SFDA0012'});
  assert.equal(environment.workers.length, 0);
  assert.equal(environment.windows.length, 0);
  assert.equal(environment.sessions.entries.size, 0);
  environment.host.dispose();
});

test('restart deliberately captures the new compilation membership for its new generation', async () => {
  const environment = twoProjects();
  const launched = await environment.host.launch({uri: 'AppA/View.cs'});
  const previous = environment.sessions.get(launched.sessionId);
  environment.source.files.push({uri: 'AppA/New.Events.cs', text: 'class NewEvents {}'});
  environment.configuration.build.compilationUris.push('AppA/New.Events.cs');
  assert.throws(() => previous.assertSourceOwnership({uris: ['AppA/New.Events.cs']}), {code: 'SFDA0012'});
  const restarted = await environment.host.restart(launched.sessionId);
  assert.equal(restarted.generation, launched.generation + 1);
  const current = environment.sessions.get(launched.sessionId);
  current.assertSourceOwnership({uris: ['AppA/New.Events.cs']});
  assert.throws(() => current.assertSourceOwnership({uris: ['AppB/View.cs']}), {code: 'SFDA0012'});
  assert.throws(() => previous.assertSourceOwnership(), {code: 'SFDA0002'});
  environment.host.dispose();
});
