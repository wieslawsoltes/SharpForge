import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {saveStudioSourceAs} from '../apps/studio/workbench/source-save-as.js';
import {sourceFileHandle} from './fixtures/a20-source-file-fixture.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return {promise, resolve, reject};
}

function capture(model) {
  return Object.freeze(Object.defineProperties({uri: model.uri, version: model.version,
    encoding: model.metadata.encoding, bom: model.metadata.bom}, {
    source: {value: model.snapshot()}, text: {get() { throw new Error('Preparation must retain source snapshots'); }}
  }));
}

test('A20 Save As starts the picker before asynchronous preparation and writes only its exact replacement capture', async () => {
  const model = new EditorModel('original  ', {uri: 'Program.cs'});
  const first = capture(model);
  const handle = sourceFileHandle('Chosen.cs', 'unchanged');
  const picked = deferred();
  const prepared = deferred();
  const entered = deferred();
  const order = [];
  const controller = new AbortController();
  const saving = saveStudioSourceAs(first, {
    signal: controller.signal,
    window: {showSaveFilePicker() { order.push('picker'); return picked.promise; }},
    async prepare({signal}) {
      assert.equal(signal, controller.signal);
      order.push('prepare');
      entered.resolve();
      return prepared.promise;
    }
  });
  assert.deepEqual(order, ['picker']);
  assert.equal(handle.metrics.opened, 0);
  picked.resolve(handle);
  await entered.promise;
  assert.equal(handle.metrics.opened, 0);
  model.applyEdits([{start: 8, end: 10, text: '\n'}]);
  const normalized = capture(model);
  prepared.resolve(normalized);
  const result = await saving;
  assert.deepEqual(order, ['picker', 'prepare']);
  assert.equal(result.ok, true);
  assert.equal(result.source, normalized.source);
  assert.equal(result.version, normalized.version);
  assert.equal(new TextDecoder().decode(handle.bytes), 'original\n');
  assert.equal(handle.metrics.written, 1);
  assert.equal(first.source.statistics.textMaterialized, false);
  model.dispose();
});

test('A20 dismissing a picker never runs a normalization callback', async () => {
  const model = new EditorModel('original  ');
  let prepared = 0;
  const result = await saveStudioSourceAs(capture(model), {
    window: {showSaveFilePicker() { throw new DOMException('Dismissed', 'AbortError'); }},
    prepare() { prepared++; throw new Error('A cancelled picker must not normalize'); }
  });
  assert.equal(result.cancelled, true);
  assert.equal(prepared, 0);
  assert.equal(model.undoStack.depth, 0);
  model.dispose();
});

test('A20 cancellation or a preparation rejection cannot open a write stream or download', async () => {
  const model = new EditorModel('original  ');
  for (const cancelled of [false, true]) {
    const handle = sourceFileHandle('Chosen.cs', 'unchanged');
    const controller = new AbortController();
    const entered = deferred();
    const completion = deferred();
    let downloads = 0;
    const saving = saveStudioSourceAs(capture(model), {
      window: {showSaveFilePicker: async () => handle}, signal: controller.signal,
      prepare() { entered.resolve(); return completion.promise; }, download() { downloads++; }
    });
    await entered.promise;
    if (cancelled) {
      controller.abort();
      completion.resolve(capture(model));
      assert.equal((await saving).cancelled, true);
    } else {
      completion.reject(new Error('Normalization unavailable'));
      await assert.rejects(saving, /Normalization unavailable/);
    }
    assert.equal(handle.metrics.opened, 0);
    assert.equal(handle.metrics.written, 0);
    assert.equal(downloads, 0);
  }
  model.dispose();
});

test('A20 a replacement capture must retain URI and a current, consistent version before write acquisition', async () => {
  const model = new EditorModel('original', {uri: 'A.cs', version: 5});
  const other = new EditorModel('other', {uri: 'B.cs', version: 5});
  const stale = new EditorModel('stale', {uri: 'A.cs', version: 4});
  const wrongMetadata = {uri: 'A.cs', version: 6, source: model.snapshot()};
  for (const replacement of [capture(other), capture(stale), wrongMetadata, undefined]) {
    const handle = sourceFileHandle('Chosen.cs', 'unchanged');
    await assert.rejects(saveStudioSourceAs(capture(model), {
      window: {showSaveFilePicker: async () => handle}, prepare: () => replacement
    }), /another document|older source|metadata|captured source/i);
    assert.equal(handle.metrics.opened, 0);
    assert.equal(handle.metrics.written, 0);
  }
  model.dispose();
  other.dispose();
  stale.dispose();
});

test('A20 download fallback prepares exactly once and still cannot report a confirmed native save', async () => {
  const model = new EditorModel('original  ');
  let prepared = 0;
  let exported;
  const result = await saveStudioSourceAs(capture(model), {
    window: {},
    async prepare() {
      prepared++;
      model.applyEdits([{start: 8, end: 10, text: '\n'}]);
      return capture(model);
    },
    async download(name, blob) { exported = {name, text: await blob.text()}; }
  });
  assert.equal(prepared, 1);
  assert.equal(result.ok, false);
  assert.equal(result.exported, true);
  assert.deepEqual(exported, {name: 'Program.cs', text: 'original\n'});
  assert.equal(result.source, model.snapshot());
  model.dispose();
});
