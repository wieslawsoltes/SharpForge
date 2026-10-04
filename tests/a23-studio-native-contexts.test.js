import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeToolsFixture} from './support/a23-native-tools.js';
import {nativeCompilationRequest, nativeDocumentReadOnly} from '../apps/studio/native-build/workspace-state.js';

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
