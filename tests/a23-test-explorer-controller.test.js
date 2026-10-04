import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestCase, createTestResult} from '@sharpforge/msbuild';
import {TestExplorerController} from '../apps/studio/test-explorer/controller.js';

function fixture() {
  const records = ['One', 'Two'].map(name => createTestCase({project: 'Tests.csproj', fqn: 'Checks.' + name,
    source: {path: 'Tests.cs', line: 4, column: 2}}));
  const input = {files: [{uri: 'Tests.cs', text: 'fixture', version: 1}], contextId: 'ctx', revision: 1};
  const state = {records, input, opened: null, request: null, closed: false};
  const adapter = {
    discover: async () => ({tests: records, diagnostics: [], discoveryId: 1}),
    run: async (request, options) => {
      state.request = request;
      options.onSession({id: 'isolated'});
      const result = createTestResult(records[1], {outcome: 'failed', message: 'assertion failed',
        source: {path: 'Tests.cs', line: 9, column: 1}});
      options.onEvent({kind: 'test-completed', result});
      return {id: 'isolated', state: 'completed', results: [result], diagnostics: [], success: false};
    },
    close() { state.closed = true; }
  };
  state.controller = new TestExplorerController({
    contexts: {request: () => ({project: 'Tests.csproj'})},
    getTestInput: async () => input,
    getTestProject: () => 'Tests.csproj',
    onOpenTestSource: source => { state.opened = source; },
    renderTests() {}
  }, {createPortable: () => adapter});
  return state;
}

test('test explorer injected host retains selection, failure location and disposal', async () => {
  const state = fixture();
  const controller = state.controller;
  try {
    await assert.rejects(controller.run(), /Discover/);
    await controller.discover();
    controller.selectAll(false);
    await assert.rejects(controller.run(), /at least one/);
    controller.select(state.records[1].id, true);
    await controller.run();
    assert.deepEqual(state.request.testIds, [state.records[1].id]);
    assert.equal(controller.snapshot().results[0].outcome, 'failed');
    await controller.openSource(state.records[1].id);
    assert.equal(state.opened.line, 9, 'failure location takes precedence over declaration');
    assert.throws(() => controller.configure({provider: 'arbitrary-process'}), /Unknown/);
    assert.throws(() => controller.configure({timeoutMs: 0}), /timeout/);
  } finally { await controller.close(); }
  assert.equal(state.closed, true);
  await assert.rejects(controller.discover(), /disposed/);
});

test('test explorer rejects changed source and project revision before another run', async () => {
  const state = fixture();
  try {
    await state.controller.discover();
    state.input.files[0].version++;
    await assert.rejects(state.controller.run(), /Source changed/);
    await state.controller.discover();
    state.input.revision++;
    await assert.rejects(state.controller.run(), /Project context changed/);
    assert.equal(state.request, null);
  } finally { await state.controller.close(); }
});

test('native VSTest selection groups theory rows at the supported method filter boundary', async () => {
  const records = ['Checks.Theory(x: 1)', 'Checks.Theory(x: 2)'].map(displayName =>
    createTestCase({project: 'Tests.csproj', fqn: 'Checks.Theory', displayName}));
  const controller = new TestExplorerController({renderTests() {}});
  controller.provider = 'native-vstest';
  controller.tests = records;
  controller.select(records[0].id, true);
  assert.equal(controller.selected.size, 2);
  controller.select(records[1].id, false);
  assert.equal(controller.selected.size, 0);
  await controller.close();
});
