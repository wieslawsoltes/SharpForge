import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceApplication} from './support/workspace-application.js';

function delayStop(app) {
  let release;
  let announce;
  const stopped = new Promise(resolve => { announce = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let first = true;
  app.host.stop = async () => {
    if (first) { first = false; announce(); await held; }
  };
  return {stopped, release: () => release()};
}

test('a later workspace load wins when an earlier load is still awaiting runtime stop', async () => {
  const app = workspaceApplication();
  const delay = delayStop(app);
  const first = app.session.load([{path: 'A.cs', text: 'class A {}'}], {name: 'First', mode: 'folder'});
  await delay.stopped;
  await app.session.load([{path: 'B.cs', text: 'class B {}'}], {name: 'Second', mode: 'folder'});
  const revision = app.state.revision;
  delay.release();
  await assert.rejects(first, /changed while stopping/);
  assert.equal(app.state.name, 'Second');
  assert.deepEqual(app.state.files.map(file => file.uri), ['B.cs']);
  assert.equal(app.state.revision, revision);
  assert.equal(app.events.filter(event => event === 'previous').length, 1);
});

test('an edit while runtime stop is pending prevents stale workspace replacement', async () => {
  const app = workspaceApplication();
  await app.session.load([{path: 'A.cs', text: 'class A {}'}], {mode: 'folder'});
  app.events.length = 0;
  const delay = delayStop(app);
  const pending = app.session.load([{path: 'B.cs', text: 'class B {}'}], {mode: 'folder'});
  await delay.stopped;
  app.edit('A.cs', 'class Newest {}');
  delay.release();
  await assert.rejects(pending, /changed while stopping/);
  assert.equal(app.state.files[0].text, 'class Newest {}');
  assert(app.state.dirtyFiles.has('A.cs'));
  assert.equal(app.events.includes('previous'), false);
});

test('cancellation during runtime stop never publishes the prepared model or saves over recovery', async () => {
  const app = workspaceApplication();
  const delay = delayStop(app);
  const controller = new AbortController();
  const pending = app.session.load([{path: 'A.cs', text: 'class A {}'}], {mode: 'folder', signal: controller.signal});
  await delay.stopped;
  controller.abort();
  delay.release();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(app.state.revision, 1);
  assert.deepEqual(app.state.files, []);
  assert.equal(app.events.includes('saved-local'), false);
});
