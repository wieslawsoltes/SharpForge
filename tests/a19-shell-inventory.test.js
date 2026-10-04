import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {registerStudioCommands} from '../apps/studio/commands/core.js';
import {toolDefinitions} from '../apps/studio/tools/definitions.js';
import {EDITOR_KEYMAPS} from '@sharpforge/editor';
import {registerShellCommands} from '../apps/studio/workbench/shell-commands.js';
import {workbenchToolDefinitions} from '../apps/studio/workbench/shell-tools.js';
import {createWorkbenchInventory} from '../apps/studio/workbench/inventory.js';
import {assessWorkbenchTrace, compareWorkbenchTraces} from './workbench-perf-budget.mjs';

test('workbench inventory matches every registered shell window and command', async () => {
  const registry = createCommandRegistry();
  registerStudioCommands(registry, {EDITOR_KEYMAPS, toolDefinitions});
  registerShellCommands({commands: registry, toolDefinitions: workbenchToolDefinitions, options: {}, tests: {providers: new Map()}});
  const actual = createWorkbenchInventory(registry);
  const saved = JSON.parse(await readFile(new URL('../docs/vs-workbench-inventory.json', import.meta.url), 'utf8'));
  assert.deepEqual(actual, saved);
  assert(actual.windows.every(window => window.status === 'registered'));
  assert.equal(new Set(actual.commands.map(command => command.id)).size, actual.commands.length);
  registry.dispose();
});

function performanceTrace(duration = 100) {
  const names = ['cold-app-startup', 'workspace-startup', 'document-switch', 'tool-activation'];
  return {format: 'sharpforge-workbench-trace', version: 2, units: 'milliseconds', captureStatus: 'completed', browserErrors: [],
    environment: {engine: 'chromium', browserVersion: '123.0', operatingSystem: 'Linux', architecture: 'x64',
      viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1, hardwareConcurrency: 4,
      servingMode: 'http-static', timingProtocol: 'fresh-context-paint-v2'},
    fixture: {id: 'workbench-501-csharp-v2', sha256: 'a'.repeat(64), sourceFiles: 501, projectFiles: 1,
      rounds: 3, documentSwitches: 1, tools: ['output'], toolPasses: 1},
    summary: names.map(name => ({name, sessionId: 'workbench', count: 3, p50: duration, p95: duration, p99: duration})),
    samples: names.flatMap(name => [0, 1, 2].map(round => ({name, sessionId: 'workbench', round, duration})))};
}

test('performance budget comparison fails absolute and twenty-percent p95 regressions', () => {
  const baseline = performanceTrace();
  assert.equal(compareWorkbenchTraces(performanceTrace(121), baseline).length, 4);
  assert.equal(compareWorkbenchTraces(performanceTrace(120), baseline).length, 0);
  assert.equal(compareWorkbenchTraces(performanceTrace(101), baseline, {'document-switch': 100}).length, 1);
  assert.throws(() => compareWorkbenchTraces({}, baseline), /trace/i);
});

test('performance comparison rejects absent, duplicate and unreported metric obligations', () => {
  const baseline = performanceTrace();
  for (const mutate of [trace => trace.summary.pop(), trace => trace.summary.push({...trace.summary[0]}),
    trace => trace.samples.pop(), trace => trace.samples.push({...trace.samples[0], name: 'unknown'})]) {
    const current = performanceTrace();
    mutate(current);
    assert.throws(() => compareWorkbenchTraces(current, baseline), /metric|sample/i);
    assert.throws(() => compareWorkbenchTraces(baseline, current), /metric|sample/i);
  }
});

test('performance comparison rejects invalid or fabricated statistics and mismatched captures', () => {
  const baseline = performanceTrace();
  const invalid = [trace => { trace.summary[0].p95 = NaN; }, trace => { trace.summary[0].p95 = Infinity; },
    trace => { trace.summary[0].p50 = -1; }, trace => { trace.summary[0].count = 1; },
    trace => { trace.samples[0].duration = Infinity; }, trace => { trace.summary[0].p99 = 101; },
    trace => { trace.samples[0].round = 1; }, trace => { trace.environment.browserVersion = '124.0'; },
    trace => { trace.fixture.sha256 = 'b'.repeat(64); }, trace => { trace.fixture.rounds = 2; },
    trace => { trace.version = 1; }, trace => { trace.browserErrors.push('uncaught'); }];
  for (const mutate of invalid) {
    const current = performanceTrace();
    mutate(current);
    assert.throws(() => compareWorkbenchTraces(current, baseline), /trace|metric|sample|environment|fixture|capture/i);
  }
  for (const budget of [NaN, Infinity, -1, '100']) {
    assert.throws(() => compareWorkbenchTraces(baseline, baseline, {'document-switch': budget}), /budget/i);
  }
  assert.throws(() => compareWorkbenchTraces(baseline, baseline, {unknown: 100}), /budget/i);
});

test('capture-only performance assessment never invents a relative regression verdict', () => {
  const trace = performanceTrace();
  assert.deepEqual(assessWorkbenchTrace(trace), {mode: 'capture', absolutePassed: true, regressionVerdict: null, failures: []});
  assert.equal(assessWorkbenchTrace(trace, performanceTrace()).regressionVerdict, true);
  const regression = assessWorkbenchTrace(performanceTrace(121), performanceTrace());
  assert.equal(regression.regressionVerdict, false);
  assert.equal(regression.failures.length, 4);
});
