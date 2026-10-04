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
import {compareWorkbenchTraces} from './workbench-perf-budget.mjs';

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

test('performance budget comparison fails absolute and twenty-percent p95 regressions', () => {
  const trace = summary => ({format: 'sharpforge-workbench-trace', units: 'milliseconds', summary});
  const baseline = trace([{name: 'switch', sessionId: 'a', p95: 100}]);
  assert.equal(compareWorkbenchTraces(trace([{name: 'switch', sessionId: 'a', p95: 121}]), baseline).length, 1);
  assert.equal(compareWorkbenchTraces(trace([{name: 'switch', sessionId: 'a', p95: 120}]), baseline).length, 0);
  assert.equal(compareWorkbenchTraces(trace([{name: 'switch', sessionId: 'a', p95: 101}]), baseline, {switch: 100}).length, 1);
  assert.throws(() => compareWorkbenchTraces({}, baseline), /traces/);
});
