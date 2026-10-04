import test from 'node:test';
import assert from 'node:assert/strict';
import { HostPermissionPolicy } from '../packages/winui-controls/src/policy/capabilities.js';
import { MediaPlayerSession } from '../packages/winui-controls/src/media/media-player.js';
import { WebViewSession } from '../packages/winui-controls/src/media/webview.js';
import { PlatformControlSession, InkStrokeModel } from '../packages/winui-controls/src/media/platform.js';
import { symbolGlyph } from '../packages/winui-controls/src/icons/index.js';

test('media autoplay denial is nonthrowing, user play works, seek clamps and restore does not start a device', async () => {
  let plays = 0;
  const backend = { play: async () => { plays++; }, pause() {}, currentTime: 0 };
  const policy = new HostPermissionPolicy({ origins: ['https://media.test'], request: async () => false });
  const player = new MediaPlayerSession({ policy, backend });
  player.setSource('https://media.test/fixture.mp4');
  assert.equal(await player.play(), false);
  assert.equal(plays, 0);
  assert.equal(await player.play({ userInitiated: true }), true);
  assert.equal(player.state, 'Playing');
  player.duration = 2;
  player.seek(20);
  assert.equal(backend.currentTime, 2);
  const snapshot = player.snapshot();
  player.restore(snapshot);
  assert.equal(player.state, 'Paused');
  assert.equal(plays, 1);
  assert.throws(() => player.seek(Infinity), error => error.code === 'SFUI16B8');
  assert.throws(() => player.setSource('file:///private/video.mp4'), error => error.code === 'SFUI1631');
});

test('pending media play is deduplicated and stale completion cannot restart a replaced source', async () => {
  let complete;
  const backend = { play: () => new Promise(resolve => { complete = resolve; }), pause() {} };
  const player = new MediaPlayerSession({ backend, policy: new HostPermissionPolicy({ origins: ['https://media.test'] }) });
  player.setSource('https://media.test/one.mp4');
  const first = player.play({ userInitiated: true });
  assert.equal(player.play({ userInitiated: true }), first);
  assert.throws(() => player.snapshot(), error => error.code === 'SFUI16B8');
  player.setSource('https://media.test/two.mp4');
  complete();
  assert.equal(await first, false);
  assert.equal(player.state, 'Opening');
});

test('media decode failures raise a stable diagnostic and absent decoder is explicit', async () => {
  const policy = new HostPermissionPolicy({ origins: ['https://media.test'] });
  const backend = { play: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }, pause() {} };
  const player = new MediaPlayerSession({ policy, backend });
  const failures = [];
  player.on('MediaFailed', value => failures.push(value));
  player.setSource('https://media.test/fixture.mp4');
  assert.equal(await player.play({ userInitiated: true }), false);
  assert.equal(failures[0].Code, 'AutoplayDenied');
  const absent = new MediaPlayerSession({ policy });
  absent.setSource('https://media.test/fixture.mp4');
  await assert.rejects(absent.play({ userInitiated: true }), error => error.code === 'SFUI16B7');
});

test('web navigation rejects outside origins with failure events and preserves committed history', () => {
  const model = new WebViewSession({ policy: new HostPermissionPolicy({ origins: ['https://allowed.test'] }) });
  const failures = [];
  model.on('NavigationCompleted', args => failures.push(args));
  assert.equal(model.navigate('https://allowed.test/one'), true);
  assert.equal(model.navigate('https://outside.test/two'), false);
  assert.equal(failures[0].IsSuccess, false);
  assert.equal(model.source, 'https://allowed.test/one');
  model.navigate('https://allowed.test/two');
  model.goBack();
  assert.equal(model.canGoForward, true);
  const snapshot = model.snapshot();
  model.navigateToString('<script>parent.secret=1</script>');
  model.restore(snapshot);
  assert.equal(model.source, 'https://allowed.test/one');
  assert.throws(() => model.executeScriptAsync(), error => error.code === 'SFUI16B5');
});

test('platform adapters require capability, dispose late attachment and reject unsupported methods', async () => {
  const absent = new PlatformControlSession('MapControl');
  await assert.rejects(absent.attach({}), error => error.code === 'SFUI16B9');
  let ready;
  let disposed = 0;
  const session = new PlatformControlSession('CaptureElement', { platform: { CaptureElement: {
    attach: () => new Promise(resolve => { ready = resolve; }) } } });
  const pending = session.attach({});
  session.dispose();
  ready({ dispose() { disposed++; } });
  assert.equal(await pending, false);
  assert.equal(disposed, 1);
  assert.throws(() => session.invoke('Play'), error => error.code === 'SFUI16BA');
});

test('ink point pressure/budgets are bounded, cancellation releases points and unicode icon validation is strict', () => {
  const ink = new InkStrokeModel({ maximumPoints: 2 });
  ink.begin(1, { x: 0, y: 0, pressure: 2 });
  ink.append(1, { x: 1, y: 1, pressure: -1 });
  assert.deepEqual(ink.active.get(1).points.map(point => point.pressure), [1, 0]);
  assert.throws(() => ink.append(1, { x: 2, y: 2 }), error => error.code === 'SFUI16BD');
  ink.end(1, true);
  assert.equal(ink.pointCount, 0);
  assert.throws(() => ink.begin(2, { x: 1, y: 1, pressure: NaN }), error => error.code === 'SFUI16BC');
  assert.equal(symbolGlyph('Add'), '\ue109');
  assert.equal(symbolGlyph(0x1f600), '😀');
  assert.throws(() => symbolGlyph(0xd800), error => error.code === 'SFUI16C0');
});
