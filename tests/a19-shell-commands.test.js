import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {ContextKeys, compileWhen} from '../apps/studio/workbench/context-keys.js';
import {contributeCommands, installCommandContext} from '../apps/studio/workbench/commands.js';
import {parseCommandLine, CommandWindow} from '../apps/studio/workbench/tools/command-window.js';
import {menuCommands} from '../apps/studio/workbench/menus.js';
import {ToolRenderScheduler} from '../apps/studio/workbench/render-scheduler.js';
import {WorkbenchPerformance} from '../apps/studio/workbench/perf.js';
import {LazyTools} from '../apps/studio/workbench/lazy-tools.js';
import {TaskCenter} from '../apps/studio/workbench/task-center.js';

test('menu palette and command window share contextual enablement and the same handler', async () => {
  const keys = new ContextKeys({debugState: 'running', sessionCount: 1, activeDocumentKind: 'code'});
  const registry = createCommandRegistry();
  let calls = 0;
  registry.registerCommand('next', 'Step Over', 'F10', () => calls++);
  const remove = installCommandContext(registry, keys);
  assert.equal(menuCommands({commands: ['next']}, registry)[0].enabled, false);
  assert.equal(registry.search('Step')[0].enabled, false);
  const window = new CommandWindow({registry});
  await assert.rejects(window.execute('Debug.StepOver'), /not available/);
  keys.update({debugState: 'paused'});
  await registry.execute('next');
  await window.execute('Debug.StepOver');
  assert.equal(calls, 2);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(registry.invoke('next', {signal: aborted.signal}), {name: 'AbortError'});
  assert.equal(calls, 2);
  remove(); registry.dispose();
  await assert.rejects(registry.execute('next'), /disposed/);
});

test('when parser handles precedence and rejects malformed executable input and nesting', () => {
  const expression = compileWhen('activeDocumentKind == code && (!readOnly || debugState == paused)');
  assert.equal(expression({activeDocumentKind: 'code', readOnly: true, debugState: 'paused'}), true);
  assert.equal(expression({activeDocumentKind: 'designer', readOnly: false}), false);
  assert.throws(() => compileWhen('window.alert(1)'), SyntaxError);
  assert.throws(() => compileWhen('activeDocumentKind =='), SyntaxError);
  assert.throws(() => compileWhen('('.repeat(40) + 'true' + ')'.repeat(40)), RangeError);
  let changes = 0;
  const context = new ContextKeys(); context.subscribe(() => changes++);
  context.update({a: true, b: false}); context.update({a: true, b: false});
  assert.equal(changes, 1);
});

test('command contributions rollback conflicts and restore replaced handlers', async () => {
  const registry = createCommandRegistry();
  registry.registerCommand('save', 'Save', '', () => 'old');
  const remove = contributeCommands(registry, [{id: 'save', title: 'Save all', execute: () => 'new'}]);
  assert.equal(await registry.execute('save'), 'new'); remove();
  assert.equal(await registry.execute('save'), 'old');
  assert.throws(() => contributeCommands(registry, [{id: 'added', title: 'Added', execute() {}}, {id: 'bad'}]), /execute/);
  assert.equal(registry.describe('added'), null);
});

test('command parser preserves quoted arguments without evaluating expressions', () => {
  assert.deepEqual(parseCommandLine('> Debug.Start "a b" \'c\''), {name: 'Debug.Start', args: ['a b', 'c']});
  assert.throws(() => parseCommandLine('Debug.Start "unfinished'), /Unclosed/);
  assert.throws(() => parseCommandLine(''), /Enter/);
  assert.throws(() => parseCommandLine('x'.repeat(8193)), RangeError);
});

test('10000 hidden output invalidations produce no render or scheduled frame', () => {
  let writes = 0, scheduled = 0, visible = false, callback;
  const scheduler = new ToolRenderScheduler({schedule: next => { callback = next; scheduled++; return scheduled; }, cancel() {}});
  scheduler.register('output', {visible: () => visible, render: () => writes++});
  for (let index = 0; index < 10000; index++) scheduler.invalidate('output');
  assert.equal(scheduled, 0); assert.equal(writes, 0);
  visible = true; scheduler.activate('output'); callback();
  assert.equal(writes, 1);
  scheduler.dispose(); scheduler.invalidate('output');
  assert.equal(writes, 1);
});

test('performance records exact per-session percentiles and enforces relative budgets', () => {
  let time = 100;
  const metrics = new WorkbenchPerformance({clock: () => time, limit: 100});
  for (let index = 1; index <= 100; index++) { const mark = metrics.start('switch', 'app'); time += index; metrics.end(mark); }
  const summary = metrics.summary()[0];
  assert.deepEqual([summary.p50, summary.p95, summary.p99], [50, 95, 99]);
  assert.equal(metrics.checkBudgets({switch: 100}, [{name: 'switch', sessionId: 'app', p95: 70}]).length, 1);
  assert.equal(JSON.parse(metrics.export()).units, 'milliseconds');
});

test('lazy activation cancellation never resolves a mount and successful module loads cache once', async () => {
  let loaded = 0, resolve;
  const lazy = new LazyTools({one: () => { loaded++; return new Promise(done => { resolve = done; }); }});
  const controller = new AbortController();
  const pending = lazy.load('one', {signal: controller.signal});
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  resolve({value: 42});
  assert.deepEqual(await lazy.load('one'), {value: 42}); assert.equal(loaded, 1);
  lazy.dispose(); await assert.rejects(lazy.load('one'), /disposed/);
});

test('two concurrent tasks cancel independently and keep truthful cancelling state', () => {
  let stoppedA = 0, stoppedB = 0;
  const center = new TaskCenter();
  const a = center.begin({id: 'a', label: 'Build A', cancel: () => stoppedA++});
  const b = center.begin({id: 'b', label: 'Build B', cancel: () => stoppedB++});
  a.cancel();
  assert.equal(a.signal.aborted, true); assert.equal(b.signal.aborted, false);
  assert.deepEqual([stoppedA, stoppedB], [1, 0]);
  assert.equal(center.list()[0].status, 'cancelling');
  a.complete(); b.complete();
  assert.deepEqual(center.list().map(task => task.status), ['cancelled', 'completed']);
  assert.throws(() => center.begin({id: 'a', label: 'Duplicate'}), /Duplicate/);
  center.dispose();
});
