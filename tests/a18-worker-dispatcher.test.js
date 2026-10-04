import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {Workspace} from '@sharpforge/workspace';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {DesignerWorkerDispatcher, createCompilerWorkerDispatcher} from '../apps/studio/designer-worker-dispatcher.js';

function dispatcher(context, handler, options = {}) {
  const protocol = createWorkerProtocol('compiler'), replies = [];
  protocol.registerHandler('designAnalyze', handler);
  const owner = new DesignerWorkerDispatcher(protocol, {...options, postMessage: reply => replies.push(structuredClone(reply))});
  context.after(() => { owner.dispose(); protocol.dispose(); });
  return {owner, protocol, replies};
}

test('async handler dispatch preserves params/context identity and awaits the result', async context => {
  let received;
  const deferred = Promise.withResolvers();
  const {owner, replies} = dispatcher(context, (params, method, local) => {
    received = {params, method, local};
    return deferred.promise;
  });
  const params = {revision: 4};
  const pending = owner.receive({id: 7, method: 'designAnalyze', params});
  assert.equal(received.params, params);
  assert.equal(received.method, 'designAnalyze');
  assert.equal(received.local.requestId, 7);
  assert.ok(received.local.signal instanceof AbortSignal);
  assert.equal(replies.length, 0);
  deferred.resolve({success: true});
  await pending;
  assert.deepEqual(replies, [{id: 7, result: {success: true}, revision: 4}]);
  assert.equal(owner.pending.size, 0);
  assert.equal(getEventListeners(received.local.signal, 'abort').length, 0);
});

test('cancel notifications abort only the target and release even a noncooperative async handler', async context => {
  const deferred = Promise.withResolvers(), signals = [];
  const {owner, replies} = dispatcher(context, (params, method, local) => {
    signals.push(local.signal);
    return params.blocked ? deferred.promise : 'other request';
  });
  const blocked = owner.receive({id: 1, method: 'designAnalyze', params: {blocked: true}});
  await owner.receive({id: 2, method: 'designAnalyze', params: {}});
  await owner.receive({method: 'cancelRequest', params: {requestId: 1}});
  await blocked;
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal(owner.pending.size, 0);
  assert.equal(replies.find(reply => reply.id === 1).error.name, 'AbortError');
  assert.equal(replies.find(reply => reply.id === 2).result, 'other request');
  deferred.resolve('late result');
  await deferred.promise;
  assert.equal(replies.length, 2, 'notification has no reply and the late result is ignored');
  assert.equal(getEventListeners(signals[0], 'abort').length, 0);
  await owner.receive({id: 3, method: 'cancelRequest', params: {requestId: 1}});
  assert.deepEqual(replies[2].result, {canceled: false});
});

test('dispatcher bounds, malformed input, structured failures and disposal are explicit', async context => {
  const deferred = Promise.withResolvers();
  const {owner, replies} = dispatcher(context, () => deferred.promise, {maxPending: 1});
  const first = owner.receive({id: 1, method: 'designAnalyze', params: {}});
  await owner.receive({id: 2, method: 'designAnalyze', params: {}});
  assert.equal(replies.at(-1).error.code, 'SFDW0006');
  await owner.receive({id: 3, method: 'unregistered', params: {}});
  assert.deepEqual(replies.at(-1), {id: 3, error: {name: 'ProtocolError',
    message: "Unknown compiler request 'unregistered'", code: 'UNKNOWN_METHOD'}});
  await owner.receive({id: 4, method: 42});
  assert.equal(replies.at(-1).error.code, 'BAD_REQUEST');
  await owner.receive({method: 'cancelRequest', params: {requestId: -1}});
  assert.equal(replies.at(-1).event, 'requestError');
  assert.equal(replies.at(-1).error.code, 'BAD_REQUEST');
  const count = replies.length;
  owner.dispose();
  await first;
  assert.equal(owner.pending.size, 0);
  deferred.resolve('disposed result');
  await deferred.promise;
  assert.equal(replies.length, count);
});

test('dispatcher transfers feature errors with the original span and diagnostic details', async context => {
  const diagnostics = [{code: 'SFSYNC_COMPILE', uri: 'View.cs', span: {start: 8, length: 2}, severity: 'error'}];
  const {owner, replies} = dispatcher(context, async () => {
    throw Object.assign(new Error('Candidate does not compile'), {code: 'SFSYNC_COMPILE', diagnostics, span: diagnostics[0].span});
  });
  await owner.receive({id: 1, method: 'designAnalyze', params: {}});
  assert.deepEqual(replies[0].error, {name: 'Error', message: 'Candidate does not compile',
    code: 'SFSYNC_COMPILE', diagnostics, span: {start: 8, length: 2}});
});

test('isolated candidates preserve active workspace documents, result, options and extensions', async context => {
  const workspace = new Workspace();
  workspace.update('Active.cs', 'public class Active { public static int Value() { return 42; } }', 1);
  workspace.compilationOptions = {outputKind: 'library'};
  const result = workspace.compile();
  assert.equal(result.success, true);
  const originalOptions = workspace.compilationOptions, originalDocuments = [...workspace.documents];
  const protocol = createWorkerProtocol('compiler'), replies = [];
  for (const method of ['designAnalyze', 'designResourceAnalyze']) protocol.registerHandler(method, async () => 'isolated');
  const owner = createCompilerWorkerDispatcher(protocol, {workspace, configureExtensions() { assert.fail('Isolated extensions leaked'); },
    extensionKey: () => 'null', postMessage: reply => replies.push(reply)});
  context.after(() => { owner.dispose(); protocol.dispose(); });
  for (const [index, method] of ['designAnalyze', 'designResourceAnalyze'].entries()) {
    await owner.receive({id: index + 1, method, params: {files: [{uri: 'Other.cs', text: 'invalid source', version: 10}],
      compilationOptions: {outputKind: 'exe'}, extensions: {analyzers: true}}});
  }
  assert.deepEqual([...workspace.documents], originalDocuments);
  assert.equal(workspace.compilationOptions, originalOptions);
  assert.equal(workspace.result, result);
  assert.deepEqual(replies.map(reply => reply.result), ['isolated', 'isolated']);
});
