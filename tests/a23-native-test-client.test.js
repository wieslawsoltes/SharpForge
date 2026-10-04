import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestCase, createTestResult} from '@sharpforge/msbuild';
import {NativeClientTestAdapter} from '../apps/studio/test-explorer/native-client.js';

function discovered(name, displayName = name) {
  return createTestCase({project: 'Tests.csproj', fqn: name, displayName, framework: 'xunit',
    source: {path: 'Tests.cs', line: 4, column: 2}});
}

test('native client starts, streams and retains explicit TRX-derived results and artifacts', async () => {
  const record = discovered('Tests.Pass');
  const result = createTestResult(record, {outcome: 'passed', backend: 'native-vstest'});
  const calls = [];
  let polls = 0;
  const client = {async service(scope, operation, request) {
    calls.push({scope, operation, request});
    if (operation === 'start') return {id: 'session'};
    if (operation === 'artifact') return {path: request.path, base64: 'AQID'};
    if (operation === 'snapshot') return {id: 'session', state: ++polls === 1 ? 'running' : 'completed', nextCursor: polls,
      events: [{sequence: polls, kind: polls === 1 ? 'output' : 'test-completed', text: 'progress', result: polls === 2 ? result : undefined}],
      result: polls === 2 ? {id: 'session', results: [result], artifacts: [{path: 'result.trx'}], success: true} : null};
  }};
  const adapter = new NativeClientTestAdapter(client);
  const events = [];
  const output = await adapter.run({project: 'Tests.csproj', trusted: true}, {pollMs: 0, onEvent: event => events.push(event)});
  assert.equal(output.success, true);
  assert.equal(events.length, 2);
  assert.equal(calls[2].request.after, 1);
  assert.deepEqual([...await adapter.artifact('session', 'result.trx')], [1, 2, 3]);
  await adapter.close();
});

test('native cancel issued as soon as session id is known preserves remaining not-run records', async () => {
  const record = discovered('Tests.Long');
  let cancelled = false;
  const client = {async service(scope, operation) {
    if (operation === 'start') return {id: 'session'};
    if (operation === 'cancel') { cancelled = true; return {}; }
    return {nextCursor: 0, events: [], result: cancelled ? {id: 'session', cancelled: true,
      results: [createTestResult(record, {outcome: 'not-run'})]} : null};
  }};
  const controller = new AbortController();
  const adapter = new NativeClientTestAdapter(client);
  const result = await adapter.run({project: 'Tests.csproj', trusted: true}, {signal: controller.signal, pollMs: 0,
    onSession: () => controller.abort()});
  assert.equal(cancelled, true);
  assert.equal(result.results[0].outcome, 'not-run');
  await adapter.close();
});
