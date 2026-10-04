import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationFrame } from '../packages/winui-controls/src/navigation/frame.js';
import { DeferralGroup, dispatchDeferred } from '../packages/winui-controls/src/overlay/deferrals.js';
import { placeOverlay, teachingTipPlacement } from '../packages/winui-controls/src/overlay/placement.js';
import { ControlEvents } from '../packages/winui-controls/src/policy/events.js';
import { XamlUICommand, StandardUICommand } from '../packages/winui-controls/src/commands/command.js';
import { RepeatController, nextToggleValue } from '../packages/winui-controls/src/buttons/index.js';
import { RefreshController } from '../packages/winui-controls/src/commands/swipe-refresh.js';
import { ManualClock } from './helpers/a16-family-clock.js';

test('frame history recreates uncached pages and retains required cached pages', () => {
  const created = [];
  const frame = new NavigationFrame({ cacheSize: 0, factory: type => {
    const page = { type, NavigationCacheMode: type === 'cached' ? 1 : 0 };
    created.push(page);
    return page;
  } });
  frame.navigate('uncached', 10);
  const first = frame.content;
  frame.navigate('cached', 20);
  const cached = frame.content;
  assert.equal(frame.canGoBack, true);
  frame.goBack();
  assert.notEqual(frame.content, first);
  assert.equal(frame.current.parameter, 10);
  frame.goForward();
  assert.equal(frame.content, cached);
  assert.equal(created.length, 3);
  frame.navigate('new');
  assert.equal(frame.canGoForward, false);
});

test('cancelled and failed navigation keep committed frame history unchanged', () => {
  const frame = new NavigationFrame({ factory: type => ({ type, OnNavigatedTo() {
    if (type === 'fail') throw new Error('page failed');
  } }) });
  frame.navigate('first');
  const first = frame.content;
  const cancel = frame.on('Navigating', args => { if (args.SourcePageType === 'cancel') args.Cancel = true; });
  assert.equal(frame.navigate('cancel'), false);
  assert.equal(frame.content, first);
  assert.equal(frame.backStackDepth, 0);
  cancel();
  assert.throws(() => frame.navigate('fail'), /page failed/);
  assert.equal(frame.content, first);
  assert.equal(frame.backStackDepth, 0);
  const snapshot = frame.snapshot();
  frame.navigate('later');
  frame.restore(snapshot);
  assert.equal(frame.content, first);
});

test('deferrals complete exactly once and the manual deadline faults unfinished work', async () => {
  const clock = new ManualClock();
  const group = new DeferralGroup({ timeout: 50, schedule: clock.schedule, cancel: clock.cancel });
  const a = group.getDeferral();
  const b = group.getDeferral();
  const result = group.seal();
  a.Complete();
  a.Complete();
  assert.equal(group.finished, false);
  b.complete();
  await result;
  assert.equal(group.finished, true);
  assert.equal(clock.timers.size, 0);
  assert.throws(() => group.getDeferral(), error => error.code === 'SFUI1661');
  const timeout = new DeferralGroup({ timeout: 10, schedule: clock.schedule, cancel: clock.cancel });
  timeout.getDeferral();
  const rejected = assert.rejects(timeout.seal(), error => error.code === 'SFUI1660');
  clock.advance(10);
  await rejected;
});

test('deferred event callbacks may cancel and thrown callbacks reject without leaking timers', async () => {
  const clock = new ManualClock();
  const source = new ControlEvents();
  source.on('Closing', args => { args.Cancel = true; args.GetDeferral().Complete(); });
  const args = await dispatchDeferred(source, 'Closing', {}, { schedule: clock.schedule, cancel: clock.cancel });
  assert.equal(args.Cancel, true);
  source.on('Broken', () => { throw new Error('handler failed'); });
  await assert.rejects(dispatchDeferred(source, 'Broken', {}, { schedule: clock.schedule, cancel: clock.cancel }), /handler failed/);
  assert.equal(clock.timers.size, 0);
});

test('overlay placement is root-relative, constrained and checks enum values', () => {
  const result = placeOverlay({ root: { left: 100, top: 50, width: 300, height: 200 },
    anchor: { left: 350, top: 220, width: 20, height: 20 }, size: { width: 100, height: 80 }, placement: 'Bottom' });
  assert.deepEqual(result, { left: 200, top: 90, placement: 'Top' });
  assert.equal(teachingTipPlacement(0, false), 'Bottom');
  assert.equal(teachingTipPlacement(13), 'Center');
  assert.throws(() => teachingTipPlacement(99), error => error.code === 'SFUI1665');
});

test('flyouts flip the primary edge, preserve alignment and allow unconstrained placement', () => {
  const options = { root: { left: 0, top: 0, width: 300, height: 200 },
    anchor: { left: 270, top: 50, width: 20, height: 20 }, size: { width: 100, height: 80 }, placement: 'RightEdgeAlignedTop' };
  assert.deepEqual(placeOverlay(options), { left: 170, top: 50, placement: 'LeftEdgeAlignedTop' });
  assert.deepEqual(placeOverlay({ ...options, constrain: false }), { left: 290, top: 50, placement: 'RightEdgeAlignedTop' });
  assert.throws(() => placeOverlay({ ...options, anchor: { left: 0, top: 0 } }), error => error.code === 'SFUI1665');
});

test('commands honor CanExecuteRequested, handled execution and per-instance notification', () => {
  const executed = [];
  const command = new XamlUICommand({ execute: value => executed.push(value), canExecute: value => value !== 'blocked' });
  assert.equal(command.execute('blocked'), false);
  assert.equal(command.execute('allowed'), true);
  command.on('ExecuteRequested', args => { args.Handled = true; });
  command.execute('handled');
  assert.deepEqual(executed, ['allowed']);
  let notifications = 0;
  const remove = command.on('CanExecuteChanged', () => notifications++);
  command.notifyCanExecuteChanged();
  remove();
  command.notifyCanExecuteChanged();
  assert.equal(notifications, 1);
  assert.equal(new StandardUICommand('Copy').KeyboardAccelerators[0].Key, 67);
  assert.throws(() => new StandardUICommand('Imaginary'), error => error.code === 'SFUI1650');
});

test('repeat timing is deterministic and tri-state toggles retain indeterminate', () => {
  const clock = new ManualClock();
  let count = 0;
  const repeat = new RepeatController(() => count++, { delay: 100, interval: 30, schedule: clock.schedule, cancel: clock.cancel });
  repeat.start();
  repeat.start();
  assert.equal(count, 1);
  clock.advance(99);
  assert.equal(count, 1);
  clock.advance(61);
  assert.equal(count, 4);
  repeat.dispose();
  clock.advance(1000);
  assert.equal(count, 4);
  assert.deepEqual([nextToggleValue(false, true), nextToggleValue(true, true), nextToggleValue(null, true)], [true, null, false]);
});

test('refresh deduplicates outstanding work and rejects handler exceptions', async () => {
  const refresh = new RefreshController();
  let complete;
  refresh.on('RefreshRequested', args => { complete = args.GetDeferral().Complete; });
  const first = refresh.request();
  assert.equal(refresh.request(), first);
  assert.throws(() => refresh.snapshot(), error => error.code === 'SFUI1660');
  complete();
  await first;
  assert.equal(refresh.pending, null);
  const broken = new RefreshController();
  broken.on('StateChanged', args => { if (args.State === 'Refreshing') throw new Error('state failed'); });
  await assert.rejects(broken.request(), /state failed/);
  assert.equal(broken.pending, null);
});
