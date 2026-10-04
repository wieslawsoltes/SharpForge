import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NativeWorkspace} from '../packages/msbuild/src/workspace.js';
import {NativeTestAdapter, registerNativeTestingServices} from '../packages/msbuild/src/testing/native-adapter.js';
import {createTestCase} from '../packages/msbuild/src/testing/model.js';

async function workspaceForTest(context) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-test-adapter-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'Tests.csproj'), '<Project/>');
  return NativeWorkspace.open(root);
}

test('A23 T11 host seam collects actual report files and exposes only retained session artifacts', async context => {
  const workspace = await workspaceForTest(context);
  const host = {runTool: async request => {
    const directory = request.arguments[request.arguments.indexOf('--results-directory') + 1];
    await writeFile(join(directory, 'results.trx'), '<TestRun><TestDefinitions><UnitTest id="1"><TestMethod ' +
      'className="Tests" name="Pass"/></UnitTest></TestDefinitions><Results><UnitTestResult testId="1" testName="Pass" ' +
      'outcome="Passed" duration="00:00:00.001"/></Results></TestRun>');
    await writeFile(join(directory, 'attachment.txt'), 'report attachment');
    return {exitCode: 0, stdout: 'Pass', stderr: '', cancelled: false};
  }};
  const adapter = new NativeTestAdapter({host, workspace});
  context.after(() => adapter.close());
  const result = await adapter.run({project: 'Tests.csproj', trusted: true});
  assert.equal(result.success, true);
  assert.equal(result.results[0].outcome, 'passed');
  const artifact = result.artifacts.find(value => value.name === 'attachment.txt');
  assert.equal(new TextDecoder().decode(await adapter.artifact(result.id, artifact.path)), 'report attachment');
  await assert.rejects(adapter.artifact(result.id, 'Tests.csproj'), /Unknown test artifact/);
  assert.equal(adapter.snapshot(result.id).result.success, true);
});

test('A23 T11 nonblocking service sessions cancel the host and leave unexecuted tests not-run', async context => {
  const workspace = await workspaceForTest(context);
  const routes = new Map();
  const registry = {disposables: [], register: (scope, operation, handler) => routes.set(scope + '/' + operation, handler)};
  const host = {runTool: async (_request, options) => {
    options.onLine({stream: 'stdout', text: 'Process Id: 1234'});
    if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener('abort', resolve, {once: true}));
    return {exitCode: null, stdout: '', stderr: '', cancelled: true};
  }};
  const adapter = registerNativeTestingServices(registry, {engine: host, workspace});
  context.after(() => adapter.close());
  const cases = [createTestCase({project: 'Tests.csproj', fqn: 'Tests.Slow'})];
  const {id} = await routes.get('testing/start')({project: 'Tests.csproj', trusted: true, tests: cases}, {});
  routes.get('testing/cancel')({id});
  await adapter.close();
  const result = routes.get('testing/snapshot')({id});
  assert.equal(result.result.output.cancelled, true);
  assert.equal(result.result.results[0].outcome, 'not-run');
  assert.equal(result.debuggerHandoff.pid, 1234);
  assert.equal(registry.disposables[0], adapter);
});

test('A23 T11 adapters reject untrusted requests and never turn a missing TRX into passing tests', async context => {
  const workspace = await workspaceForTest(context);
  const host = {runTool: async () => ({exitCode: 0, stdout: 'Passed!', stderr: '', cancelled: false})};
  const adapter = new NativeTestAdapter({host, workspace});
  context.after(() => adapter.close());
  await assert.rejects(adapter.run({project: 'Tests.csproj'}), /trust/);
  const result = await adapter.run({project: 'Tests.csproj', trusted: true});
  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0].code, 'SFT2305');
  await adapter.close();
  await assert.rejects(adapter.run({project: 'Tests.csproj', trusted: true}), /disposed/);
});

test('A23 T11 service discovery preserves HTTP source metadata and rejects oversized metadata before execution', async context => {
  const workspace = await workspaceForTest(context);
  const routes = new Map();
  let executions = 0;
  const host = {runTool: async () => {
    executions++;
    return {exitCode: 0, stdout: 'The following Tests are available:\n    Tests.Pass\n', stderr: ''};
  }};
  const registry = {disposables: [], register: (scope, operation, handler) => routes.set(scope + '/' + operation, handler)};
  const adapter = registerNativeTestingServices(registry, {engine: host, workspace});
  context.after(() => adapter.close());
  const source = createTestCase({project: 'Tests.csproj', fqn: 'Tests.Pass', framework: 'xunit',
    source: {path: 'Tests.cs', line: 7}, traits: {Category: ['fast']}});
  const result = await routes.get('testing/discover')({project: 'Tests.csproj', trusted: true, sourceTests: [source]}, {});
  assert.equal(result.tests[0].id, source.id);
  assert.equal(result.tests[0].source.line, 7);
  assert.deepEqual(result.tests[0].traits.Category, ['fast']);
  await assert.rejects(adapter.discover({project: 'Tests.csproj', trusted: true, sourceTests: Array(100001).fill(source)}), /metadata limit/);
  assert.equal(executions, 1);
});
