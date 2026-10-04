import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeToolsFixture} from './support/a23-native-tools.js';
import {decodeNativeMetadata} from '../apps/studio/native-build/metadata.js';
import {nativeCompilationRequest, nativeDocumentReadOnly, applyNativeProjectContext} from '../apps/studio/native-build/workspace-state.js';

test('native connection is read-only and context hydration requires trust before any evaluation', async () => {
  const {tools, client, calls, state} = nativeToolsFixture();
  await tools.connect(client);
  assert.equal(state.nativeMode, false);
  await assert.rejects(tools.contexts.load(), /trust/);
  assert.deepEqual(calls.map(call => call.kind), ['connect']);
  await tools.dispose();
});

test('active native context supplies exact source set, generated documents and metadata compiler options', async () => {
  const {tools, client, calls, state, contexts} = nativeToolsFixture();
  await tools.connect(client);
  tools.settings.trusted = true;
  await tools.contexts.load();
  const first = nativeCompilationRequest(state);
  assert.deepEqual(first.files.map(file => file.uri), ['App/One.cs', 'App/obj/net8.0/GlobalUsings.g.cs']);
  assert.equal(first.compilationOptions.nullable, 'enable');
  assert.equal(first.compilationOptions.langVersion, '12');
  assert.equal(first.compilationOptions.allowUnsafe, true);
  assert.equal(first.compilationOptions.checkOverflow, true);
  assert.deepEqual([...first.compilationOptions.references[0].bytes], [1, 2, 3]);
  assert.equal(first.files[0].nativeHash, 'hash:App/One.cs');
  assert.equal(nativeDocumentReadOnly(state, first.files[0]), false);
  assert.equal(nativeDocumentReadOnly(state, first.files[1]), true);
  await tools.contexts.select(contexts[1].id);
  const second = nativeCompilationRequest(state);
  assert.deepEqual(second.files.map(file => file.uri), ['App/Ten.cs', 'App/obj/net10.0/GlobalUsings.g.cs']);
  assert.equal(state.files.some(file => file.uri === 'App/One.cs'), true, 'an open ordinary file survives context changes');
  assert.equal(state.files.some(file => file.uri === 'App/obj/net8.0/GlobalUsings.g.cs'), false);
  assert.equal(tools.settings.framework, 'net10.0');
  assert.equal(tools.contexts.diagnostics[0].targetFramework, 'net10.0');
  assert.equal(calls.filter(call => call.kind === 'contexts').length, 1, 'selection reuses evaluated contexts');
  assert.equal(calls.filter(call => call.kind === 'metadata').at(-1).request.framework, 'net10.0');
  await tools.dispose();
});

test('source read failure and cancellation never activate a partially hydrated native context', async () => {
  const {tools, client, state, contexts} = nativeToolsFixture();
  await tools.connect(client);
  tools.settings.trusted = true;
  await tools.contexts.load();
  const previous = state.nativeProjectContext;
  const read = client.read;
  client.read = async path => { if (path === 'App/Ten.cs') throw new Error('Read refused'); return read(path); };
  await assert.rejects(tools.contexts.select(contexts[1].id), /Read refused/);
  assert.equal(state.nativeProjectContext, previous);
  client.read = async path => {
    if (path === 'App/Ten.cs') await tools.cancel();
    return read(path);
  };
  await assert.rejects(tools.contexts.select(contexts[1].id), error => error.name === 'AbortError');
  assert.equal(state.nativeProjectContext, previous);
  assert.equal(tools.busy, false);
  await tools.dispose();
});

test('native metadata validates identity, count, byte budgets, encoding, size and SHA-256', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const reference = {path: '/sdk/Contract.dll', base64: 'AQID', size: 3, sha256: createHash('sha256').update(bytes).digest('hex')};
  const report = {contextId: 'context', references: [reference], totalBytes: 3};
  assert.deepEqual((await decodeNativeMetadata(report, 'context'))[0].bytes, bytes);
  await assert.rejects(decodeNativeMetadata(report, 'other'), /different project context/);
  await assert.rejects(decodeNativeMetadata({...report, references: Array(513).fill(reference)}, 'context'), /count/);
  await assert.rejects(decodeNativeMetadata(report, 'context', {maxBytes: 2}), /byte limit/);
  await assert.rejects(decodeNativeMetadata({...report, references: [{...reference, base64: '!!!!'}]}, 'context'), /encoding/);
  await assert.rejects(decodeNativeMetadata({...report, references: [{...reference, sha256: 'a'.repeat(64)}]}, 'context'), /hash mismatch/);
  await assert.rejects(decodeNativeMetadata({...report, totalBytes: 4}, 'context'), /aggregate/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decodeNativeMetadata(report, 'context', {signal: controller.signal}), error => error.name === 'AbortError');
});

test('context application preserves edits made while reads are in flight and keeps generated source immutable', () => {
  const state = {nativeMode: true, files: [{uri: 'A.cs', text: 'local', version: 9, nativeBaseline: 'base', nativeHash: 'old'}],
    tabs: ['A.cs'], active: 'A.cs', revision: 1};
  applyNativeProjectContext(state, {context: {id: 'id', properties: {}, project: 'A.csproj'}, compilation: {
    options: {}, files: [{uri: 'A.cs', text: 'remote', hash: 'new'}, {uri: 'A.g.cs', text: 'generated', generated: true}]
  }});
  assert.equal(state.files[0].text, 'local');
  assert.equal(state.files[0].nativeHash, 'old');
  assert.equal(state.files[1].readOnly, true);
  assert.equal(nativeCompilationRequest({...state, nativeMode: false}), null);
  assert.throws(() => applyNativeProjectContext({...state, nativeMode: false}, {}), /Attach/);
});
