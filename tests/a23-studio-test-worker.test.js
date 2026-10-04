import test from 'node:test';
import assert from 'node:assert/strict';
import {PortableWorkerTestAdapter} from '../apps/studio/test-explorer/worker-client.js';
import {createTestWorkerService} from '../apps/studio/test-explorer/worker-service.js';

export class InProcessTestWorker {
  constructor(adapter) {
    this.terminated = false;
    this.service = createTestWorkerService({adapter, postMessage: message => {
      if (!this.terminated) queueMicrotask(() => this.onmessage?.({data: structuredClone(message)}));
    }});
  }
  postMessage(message) { void this.service.receive(structuredClone(message)); }
  terminate() { this.terminated = true; this.service.close(); }
}

export const sourceFixture = [{uri: 'Checks.cs', version: 1, text: `using Xunit;
public class Checks {
    static int count;
    [Fact] public void Isolated() { count++; Assert.Equal(1, count); }
    [Fact] public void Failing() { Assert.True(false); }
    [Fact(Skip="intentional")] public void Skipped() { Assert.True(false); }
}`}];

for (const backend of ['source', 'cil']) test('portable worker protocol discovers and executes isolated ' + backend + ' sessions', async () => {
  let workers = 0;
  const client = new PortableWorkerTestAdapter({createWorker: () => { workers++; return new InProcessTestWorker(); }});
  assert.equal(workers, 0, 'worker is lazy');
  const discovery = await client.discover({sources: sourceFixture, project: 'Checks.csproj', backend});
  assert.equal(discovery.tests.length, 3);
  const events = [];
  const result = await client.run({discoveryId: discovery.discoveryId, backend, timeoutMs: 30000}, {onEvent: event => events.push(event)});
  assert.equal(result.results.filter(result => result.outcome === 'passed').length, 1);
  assert.equal(result.results.filter(result => result.outcome === 'failed').length, 1);
  assert.equal(result.results.filter(result => result.outcome === 'skipped').length, 1);
  assert.equal(result.success, false, 'intentional assertion failure is retained');
  assert.ok(events.some(event => event.kind === 'test-completed'));
  const isolated = discovery.tests.find(test => test.fqn.endsWith('.Isolated'));
  const repeat = await client.run({discoveryId: discovery.discoveryId, backend, testIds: [isolated.id]});
  assert.equal(repeat.results.length, 1);
  assert.equal(repeat.results[0].outcome, 'passed', 'a new VM owns static state on each run');
  await assert.rejects(client.run({discoveryId: 999, backend}), /discover tests again/);
  await assert.rejects(client.run({discoveryId: discovery.discoveryId, testIds: ['unknown']}), /current discovery/);
  client.close();
  assert.throws(() => client.discover({sources: sourceFixture}), /disposed/);
});

test('portable worker cancellation propagates without losing the response channel', async () => {
  const testCase = {id: 'one', fqn: 'Checks.One'};
  const adapter = {discover: async () => ({tests: [testCase], diagnostics: []}),
    run: async (discovery, options) => new Promise(resolve => {
      options.onSession({id: 'session'});
      options.signal.addEventListener('abort', () => resolve({id: 'session', cancelled: true, results: []}), {once: true});
    }), close() {}};
  const client = new PortableWorkerTestAdapter({createWorker: () => new InProcessTestWorker(adapter)});
  const discovery = await client.discover({sources: [], project: 'Checks.csproj'});
  const controller = new AbortController();
  const result = await client.run({discoveryId: discovery.discoveryId}, {signal: controller.signal,
    onSession: () => controller.abort()});
  assert.equal(result.cancelled, true);
  assert.equal(client.pending.size, 0);
  client.close();
});

test('worker service rejects malformed, overlapping and oversized discovery requests', async () => {
  const messages = [];
  let release;
  const adapter = {discover: () => new Promise(resolve => { release = resolve; }), close() {}};
  const service = createTestWorkerService({adapter, postMessage: value => messages.push(value)});
  await service.receive({id: 1, method: 'unsupported'});
  assert.match(messages.pop().error.message, /Invalid/);
  const first = service.receive({id: 2, method: 'discover', params: {sources: [], project: 'Checks.csproj'}});
  await service.receive({id: 3, method: 'discover', params: {sources: []}});
  assert.match(messages.pop().error.message, /active/);
  release({tests: [], diagnostics: []});
  await first;
  await service.receive({id: 4, method: 'discover', params: {sources: Array(20001).fill({})}});
  assert.match(messages.pop().error.message, /source set/);
  service.close();
});

test('portable discovery and execution preserve project constants while the harness owns its entry point', async () => {
  const client = new PortableWorkerTestAdapter({createWorker: () => new InProcessTestWorker()});
  const sources = [{uri: 'Conditional.cs', text: `using Xunit;
public class Conditional {
#if SELECTED
  [Fact] public void Active() { Assert.True(true); }
#else
  [Fact] public void Inactive() { unknownSymbol(); }
#endif
}`}];
  const discovery = await client.discover({sources, project: 'Conditional.csproj',
    compilationOptions: {defines: ['SELECTED'], preprocessorSymbols: ['SELECTED'], langVersion: '12', outputKind: 'library'}});
  assert.deepEqual(discovery.tests.map(test => test.fqn), ['Conditional.Active']);
  const result = await client.run({discoveryId: discovery.discoveryId});
  assert.equal(result.results[0].outcome, 'passed');
  client.close();
});
