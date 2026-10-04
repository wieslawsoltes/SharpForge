import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationSession } from '../packages/winui-controls/src/app/application.js';
import { WindowSession } from '../packages/winui-controls/src/app/window.js';
import { ActivationService } from '../packages/winui-controls/src/app/activation.js';

test('application suspension waits for deferrals and preserves explicit state across resume', async () => {
  const saved = [];
  const app = new ApplicationSession({ saveState: state => saved.push(state) });
  app.start();
  let complete;
  app.on('Suspending', args => { args.State = { page: 'editor' }; complete = args.GetDeferral().Complete; });
  const result = app.suspend();
  assert.equal(app.suspend(), result);
  assert.equal(app.state, 'running');
  assert.throws(() => app.snapshot(), error => error.code === 'SFUI16A3');
  complete();
  assert.equal(await result, true);
  assert.equal(app.state, 'suspended');
  assert.deepEqual(saved, [{ page: 'editor' }]);
  app.resume();
  assert.equal(app.state, 'running');
  assert.deepEqual(app.suspensionState, { page: 'editor' });
});

test('resume supersedes pending suspension and visibility changes stay application-local', async () => {
  const app = new ApplicationSession();
  app.start();
  const a = new WindowSession();
  const b = new WindowSession();
  const other = new ApplicationSession();
  other.start();
  app.registerWindow('a', a);
  other.registerWindow('b', b);
  a.activate();
  b.activate();
  app.visibility(false);
  assert.equal(a.visible, false);
  assert.equal(b.visible, true);
  app.on('Suspending', args => args.GetDeferral());
  const suspended = app.suspend();
  app.resume();
  assert.equal(await suspended, false);
  assert.equal(app.state, 'running');
});

test('window cancellation, close deduplication, bounds and presenters report explicit state', async () => {
  const window = new WindowSession({ width: 300, height: 200 });
  window.activate();
  const cancel = window.on('Closing', args => { args.Cancel = true; });
  assert.equal(await window.close(), false);
  assert.equal(window.closed, false);
  cancel();
  let complete;
  window.on('Closing', args => { complete = args.GetDeferral().Complete; });
  const first = window.close();
  assert.equal(window.close(), first);
  complete();
  assert.equal(await first, true);
  assert.equal(window.visible, false);
  assert.equal(await window.close(), false);
  assert.throws(() => window.activate(), error => error.code === 'SFUI16A7');
  const other = new WindowSession();
  const bounds = { ...other.bounds };
  assert.throws(() => other.resize(-1, 20), error => error.code === 'SFUI16A6');
  assert.deepEqual(other.bounds, bounds);
  await assert.rejects(other.setPresenter('FullScreen'), error => error.code === 'SFUI16A8');
});

test('preserveValues disposal emits no lifecycle callbacks and leaves rewind values intact', () => {
  const app = new ApplicationSession({ resources: { id: 'resources' } });
  const window = new WindowSession();
  app.start();
  window.activate();
  window.content = { id: 'content' };
  app.registerWindow('window', window);
  let exits = 0;
  app.on('Exiting', () => exits++);
  const appState = app.snapshot();
  const windowState = window.snapshot();
  app.dispose({ preserveValues: true, restoring: true });
  window.dispose({ preserveValues: true, collected: true });
  assert.deepEqual(app.snapshot(), appState);
  assert.deepEqual(window.snapshot(), windowState);
  assert.equal(exits, 0);
  app.exit();
  app.exit();
  assert.equal(exits, 1);
});

test('activation returns launch arguments, requires file grants and rejects unsupported protocols', async () => {
  const rejected = [];
  const activation = new ActivationService({ url: 'https://example.test/app?open=1', policy: { authorize: async () => false } });
  assert.equal(activation.getActivatedEventArgs().Data.Arguments, 'open=1');
  assert.equal(activation.getActivatedEventArgs().Kind, 'Protocol');
  activation.on('ActivationRejected', args => rejected.push(args));
  await activation.acceptLaunch({ files: [{ name: 'file.txt' }] });
  assert.equal(rejected[0].Reason, 'permission-denied');
  activation.activateProtocol('https://example.test/deep');
  assert.equal(activation.getActivatedEventArgs().Kind, 'Protocol');
  assert.throws(() => activation.activateProtocol('javascript:alert(1)'), error => error.code === 'SFUI16A4');
  const snapshot = activation.snapshot();
  activation.activateProtocol('https://example.test/later');
  activation.restore(snapshot);
  assert.equal(activation.getActivatedEventArgs().Data.Uri, 'https://example.test/deep');
});
