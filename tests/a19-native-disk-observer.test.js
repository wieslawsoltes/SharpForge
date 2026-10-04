import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EditorModel} from '@sharpforge/editor';
import {encodeWorkspaceFile} from '@sharpforge/project-system';
import {MSBuildClient} from '@sharpforge/msbuild';
import {NativeWorkspace} from '@sharpforge/msbuild/node';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {createStudioDiskObserver} from '../apps/studio/workbench/studio-disk-observer.js';
import {deferred} from './fixtures/a19-disk-observation.js';

async function nativeContext(t, {encoding = 'utf-8', bom = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-observer-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const uri = 'Program.cs';
  const file = join(root, uri);
  await writeFile(file, encodeWorkspaceFile({path: uri, text: 'original', encoding, bom}));
  const client = await NativeWorkspace.open(root);
  const original = await client.read(uri);
  const documents = new DocumentService({records: [{uri, text: original.text, version: 1,
    encoding, bom, nativeHash: original.hash, nativeBaseline: original.text}],
    createModel: record => new EditorModel(record.text, record)});
  const native = {client};
  const observer = createStudioDiskObserver({documents, state: () => ({nativeMode: true}), nativeBuild: () => native,
    target() { throw new Error('Native observation must not use browser handles'); }, confirm: () => true});
  t.after(() => { observer.dispose(); documents.dispose(); });
  return {uri, file, client, original, documents, native, observer,
    reload(observed) { return observer.reload(uri, observed.text, {observation: observed.observation,
      expectedRecord: documents.get(uri), expectedVersion: documents.get(uri).version, confirmDirty: true}); }};
}

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`A19 actual native ${encoding} reload updates SHA-256 and native baseline before a physical save`, async t => {
    const context = await nativeContext(t, {encoding, bom: true});
    const {uri, file, observer, documents, client, original} = context;
    const text = 'external 😀界';
    await writeFile(file, encodeWorkspaceFile({path: uri, text, encoding, bom: true}));
    const observed = await observer.read(uri);
    const external = await client.read(uri);
    assert.notEqual(external.hash, original.hash);
    await context.reload(observed);
    const record = documents.get(uri);
    assert.equal(record.nativeHash, external.hash);
    assert.equal(record.nativeBaseline, text);
    assert.equal(record.dirty, false);
    assert.equal(documents.models.get(uri).metadata.encoding, encoding);
    documents.update(uri, text + ' next');
    const capture = documents.captureSave(uri);
    const saved = await client.save([{path: uri, text: capture.text, expectedHash: capture.nativeHash}]);
    assert.equal(saved.written.length, 1);
    assert.deepEqual(new Uint8Array(await readFile(file)), encodeWorkspaceFile({path: uri, text: capture.text, encoding, bom: true}));
  });
}

test('A19 reconnecting the native host invalidates a prior observation without changing the document', async t => {
  const context = await nativeContext(t);
  const {uri, file, observer, native, documents} = context;
  await writeFile(file, 'external');
  const observed = await observer.read(uri);
  native.client = {read() { throw new Error('A stale action must not query the replacement client'); }};
  await assert.rejects(context.reload(observed), {code: 'STUDIO_DISK_OBSERVATION_STALE'});
  assert.equal(documents.get(uri).text, 'original');
});

test('A19 native bytes changed after the observation are not marked as the reloaded baseline', async t => {
  const context = await nativeContext(t);
  const {uri, file, observer, documents, original} = context;
  await writeFile(file, 'external');
  const observed = await observer.read(uri);
  await writeFile(file, 'different');
  await assert.rejects(context.reload(observed), {code: 'STUDIO_DISK_OBSERVATION_STALE'});
  assert.equal(documents.get(uri).text, 'original');
  assert.equal(documents.get(uri).nativeHash, original.hash);
});

test('A19 rejecting immutable native metadata restores the document and retains both previous native baseline fields', async t => {
  const context = await nativeContext(t);
  const {uri, file, observer, documents, original} = context;
  await writeFile(file, 'external');
  const observed = await observer.read(uri);
  const record = documents.get(uri);
  Object.defineProperty(record, 'nativeBaseline', {value: original.text, configurable: false, writable: false});
  await assert.rejects(context.reload(observed), /baseline metadata is immutable/);
  assert.equal(record.text, original.text);
  assert.equal(record.nativeHash, original.hash);
  assert.equal(record.nativeBaseline, original.text);
  assert.equal(record.dirty, false);
});

test('A19 native read cancellation and disposal reach the actual client request signal', async t => {
  const context = await nativeContext(t);
  const entered = deferred();
  let received;
  context.native.client = {read(uri, {signal}) {
    received = signal;
    entered.resolve();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {once: true}));
  }};
  const reading = context.observer.read(context.uri);
  await entered.promise;
  context.observer.dispose();
  await assert.rejects(reading, {name: 'AbortError'});
  assert.equal(received.aborted, true);
  assert.equal(context.documents.get(context.uri).text, 'original');
});

test('A19 MSBuild text and binary read APIs forward the supplied cancellation signal without changing endpoints', async () => {
  const requested = [];
  const client = new MSBuildClient({token: 'a'.repeat(64), async fetch(url, options) {
    requested.push({url, options});
    return {ok: true, json: async () => ({path: 'Program.cs', text: 'source'}), arrayBuffer: async () => new Uint8Array([1, 2]).buffer};
  }});
  const controller = new AbortController();
  assert.equal((await client.read('Folder/Program.cs', {signal: controller.signal})).text, 'source');
  assert.deepEqual(await client.binary('Folder/Reference.dll', {signal: controller.signal}), new Uint8Array([1, 2]));
  assert.deepEqual(requested.map(request => request.url), [
    '/api/msbuild/file?path=Folder%2FProgram.cs', '/api/msbuild/binary?path=Folder%2FReference.dll'
  ]);
  assert(requested.every(request => request.options.signal === controller.signal));
});
