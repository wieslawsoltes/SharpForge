import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestCase, createTestResult} from '@sharpforge/msbuild';
import {MSBuildTools} from '../apps/studio/msbuild-tools.js';
import {nativeToolsFixture} from './support/a23-native-tools.js';

function discovered(name, displayName = name) {
  return createTestCase({project: 'Tests.csproj', fqn: name, displayName, framework: 'xunit',
    source: {path: 'Tests.cs', line: 4, column: 2}});
}

test('test explorer enforces discovery, source versions, selected ids and failure details', async () => {
  const one = discovered('Tests.One');
  const two = discovered('Tests.Two');
  const sources = [{uri: 'Tests.cs', text: 'fixture', version: 1}];
  let runRequest;
  let opened;
  const adapter = {discover: async () => ({tests: [one, two], diagnostics: [], discoveryId: 1}),
    run: async (request, options) => {
      runRequest = request;
      options.onSession({id: 'isolated'});
      const result = createTestResult(two, {outcome: 'failed', message: 'assertion failed', source: {path: 'Tests.cs', line: 9}});
      options.onEvent({kind: 'test-completed', result});
      return {id: 'isolated', state: 'completed', results: [result], diagnostics: [], success: false};
    }, close() {}};
  const tools = new MSBuildTools({getTestSources: () => sources, getTestProject: () => 'Tests.csproj',
    onOpenTestSource: source => { opened = source; }, testAdapters: {createPortable: () => adapter}});
  await assert.rejects(tools.tests.run(), /Discover/);
  await tools.tests.discover();
  tools.tests.selectAll(false);
  await assert.rejects(tools.tests.run(), /at least one/);
  tools.tests.select(two.id, true);
  await tools.tests.run();
  assert.deepEqual(runRequest.testIds, [two.id]);
  assert.equal(tools.tests.snapshot().results[0].outcome, 'failed');
  await tools.tests.openSource(two.id);
  assert.equal(opened.line, 9, 'failure location takes precedence over declaration');
  sources[0].version++;
  await assert.rejects(tools.tests.run(), /Source changed/);
  assert.throws(() => tools.tests.configure({provider: 'arbitrary-process'}), /Unknown/);
  assert.throws(() => tools.tests.configure({timeoutMs: 0}), /timeout/);
  await tools.dispose();
});

test('native Test Explorer forwards framework selection and server-side discovery records through real controller', async () => {
  const record = discovered('Tests.Native');
  const {tools, client, calls} = nativeToolsFixture();
  client.service = async (scope, operation, request) => {
    calls.push({kind: 'service', scope, operation, request});
    if (operation === 'discover') return {tests: [record], diagnostics: []};
    if (operation === 'start') return {id: 'native-session'};
    if (operation === 'snapshot') return {events: [], nextCursor: 0, result: {id: 'native-session', state: 'completed',
      results: [createTestResult(record, {outcome: 'skipped'})], success: true, diagnostics: []}};
  };
  await tools.connect(client);
  tools.settings.trusted = true;
  tools.settings.framework = 'net10.0';
  await tools.tests.discover();
  await tools.tests.run();
  const request = calls.find(call => call.operation === 'start').request;
  assert.equal(request.framework, 'net10.0');
  assert.equal(request.trusted, true);
  assert.equal(request.runner, 'vstest');
  assert.deepEqual(request.tests.map(test => test.id), [record.id]);
  assert.equal(tools.tests.snapshot().results[0].outcome, 'skipped');
  await tools.dispose();
});

test('structured asynchronous test input keeps hydrated source, compiler options and context revision together', async () => {
  const record = discovered('Tests.Prepared');
  let revision = 1;
  let received;
  const input = {files: [{uri: 'Tests.cs', text: 'prepared', version: 1}], contextId: 'net10.0',
    compilationOptions: {defines: ['CONTEXT'], references: [{bytes: new Uint8Array([1, 2]), display: 'Library.dll'}]}};
  const adapter = {discover: async request => { received = request; return {tests: [record], discoveryId: 1}; }, close() {}};
  const tools = new MSBuildTools({getTestInput: async () => ({...input, revision}),
    testAdapters: {createPortable: () => adapter}});
  await tools.tests.discover();
  assert.deepEqual(received.sources, input.files);
  assert.deepEqual(received.compilationOptions, input.compilationOptions);
  revision++;
  await assert.rejects(tools.tests.run(), /Project context changed/);
  await tools.dispose();
});

test('native discovery cannot run against a different project framework or property set', async () => {
  const record = discovered('Tests.Native');
  const {tools, client, calls, workspace} = nativeToolsFixture();
  workspace.projects.push('Other/Other.csproj');
  client.service = async (scope, operation) => {
    calls.push({kind: 'service', operation});
    if (operation === 'discover') return {tests: [record]};
    throw new Error('A stale discovery reached execution');
  };
  await tools.connect(client);
  tools.settings.trusted = true;
  tools.settings.framework = 'net8.0';
  await tools.tests.discover();
  tools.settings.framework = 'net10.0';
  await assert.rejects(tools.tests.run(), /Project context changed/);
  tools.settings.framework = 'net8.0';
  tools.settings.properties = 'Feature=enabled';
  await assert.rejects(tools.tests.run(), /Project context changed/);
  tools.settings.properties = '';
  tools.contexts.setProject('Other/Other.csproj');
  await assert.rejects(tools.tests.run(), /Project context changed/);
  assert.equal(calls.some(call => call.operation === 'start'), false);
  await tools.dispose();
});
