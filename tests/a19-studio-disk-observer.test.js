import test from 'node:test';
import assert from 'node:assert/strict';
import {DiskWorkspace, encodeWorkspaceFile} from '@sharpforge/project-system';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {sourceFileHandle, SlicedFile} from './fixtures/a20-source-file-fixture.js';
import {deferred, diskObservationContext, observationLimits} from './fixtures/a19-disk-observation.js';

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`A19 ${encoding} observation uses the granted handle and preserves encoding through reload and the next save`, async t => {
    const context = await diskObservationContext(t, {encoding});
    const {uri, handle, disk, documents, observer} = context;
    const record = documents.get(uri);
    const model = documents.models.get(uri);
    for (const bom of [false, true]) {
      const version = disk.getVersion(uri);
      context.external('class C { string Text = "😀界"; }\r\n', {bom});
      const observed = await observer.read(uri);
      assert.equal(observed.encoding, encoding);
      assert.equal(observed.bom, bom);
      assert.equal(observed.text, 'class C { string Text = "😀界"; }\r\n');
      assert.equal('model' in observed, false);
      assert.equal('source' in observed, false);
      assert.equal(await context.reload(observed), true);
      assert.equal(documents.get(uri), record);
      assert.equal(documents.models.get(uri), model);
      assert.equal(disk.byPath.get(uri).model, undefined);
      assert.equal(record.dirty, false);
      assert.equal(model.metadata.encoding, encoding);
      assert.equal(model.metadata.bom, bom);
      assert.equal(record.source, record.originalSource);
      assert.equal(disk.getVersion(uri), version + 1);
      documents.update(uri, observed.text + '// next\n', {version: record.version});
      const captured = documents.captureSave(uri);
      await disk.save([captured]);
      documents.markSaved(uri, captured);
      assert.deepEqual(handle.bytes, encodeWorkspaceFile({path: uri, text: captured.text, encoding, bom}));
      assert.equal(record.dirty, false);
    }
    assert(handle.reads.every(read => read.end - read.start <= 256 * 1024));
  });
}

test('A19 a Save As target overrides the original workspace handle and receives the accepted baseline', async t => {
  const context = await diskObservationContext(t);
  const {uri, documents, observer, disk: originalDisk, handle: originalHandle} = context;
  const chosenHandle = sourceFileHandle('Chosen.cs', 'original');
  const selected = await readStudioSource(await chosenHandle.getFile(), {path: uri});
  t.after(() => selected.model.dispose());
  const chosenDisk = new DiskWorkspace([selected], new Map([[uri, chosenHandle]]), 'Chosen.cs', [], [], {
    ...observationLimits, readSource: readStudioSource
  });
  context.target = chosenDisk;
  chosenHandle.setExternal('chosen external');
  originalHandle.setExternal('original external');
  const observed = await observer.read(uri);
  assert.equal(observed.text, 'chosen external');
  await context.reload(observed);
  assert.equal(chosenDisk.getVersion(uri), 2);
  assert.equal(originalDisk.getVersion(uri), 1);
  documents.update(uri, 'save to chosen');
  await chosenDisk.save([documents.captureSave(uri)]);
  assert.equal(new TextDecoder().decode(chosenHandle.bytes), 'save to chosen');
  assert.equal(new TextDecoder().decode(originalHandle.bytes), 'original external');
  assert.equal(originalHandle.metrics.opened, 0);
});

test('A19 an empty no-BOM UTF-16 observation remains an editable zero-byte source after reload', async t => {
  const context = await diskObservationContext(t, {encoding: 'utf-16le'});
  const {uri, observer, documents, disk, handle} = context;
  context.external('');
  const observed = await observer.read(uri);
  assert.equal(observed.text, '');
  assert.equal(observed.byteLength, 0);
  await context.reload(observed);
  assert.equal(documents.get(uri).text, '');
  assert.equal(documents.get(uri).byteLength, 0);
  documents.update(uri, 'new');
  await disk.save([documents.captureSave(uri)]);
  assert.deepEqual(handle.bytes, encodeWorkspaceFile({path: uri, text: 'new', encoding: 'utf-16le', bom: false}));
});

test('A19 same-URI workspace replacement and later editor edits both invalidate an old observation', async t => {
  const context = await diskObservationContext(t);
  const {uri, documents, observer, disk} = context;
  context.external('external');
  const observed = await observer.read(uri);
  const previous = documents.get(uri);
  documents.replace([{uri, text: 'replacement', version: previous.version}], {discard: true});
  await assert.rejects(context.reload(observed), {code: 'STUDIO_DISK_OBSERVATION_STALE'});
  assert.equal(documents.get(uri).text, 'replacement');
  assert.equal(disk.getVersion(uri), 1);
  const current = await observer.read(uri);
  documents.update(uri, 'new edit');
  await assert.rejects(context.reload(current), {code: 'STUDIO_DISK_OBSERVATION_STALE'});
  assert.equal(documents.get(uri).text, 'new edit');
});

test('A19 confirmation cannot overwrite a replacement document, a later edit, or a changed target', async t => {
  for (const mutate of ['replace', 'edit', 'target']) {
    const gate = deferred();
    const entered = deferred();
    const context = await diskObservationContext(t, {confirm() { entered.resolve(); return gate.promise; }});
    const {uri, documents, observer, disk} = context;
    documents.update(uri, 'unsaved');
    context.external('external');
    const observed = await observer.read(uri);
    const reloading = context.reload(observed);
    await entered.promise;
    if (mutate === 'replace') documents.replace([{uri, text: 'replacement', version: documents.get(uri).version}], {discard: true});
    else if (mutate === 'edit') documents.update(uri, 'later edit');
    else context.target = null;
    gate.resolve(true);
    await assert.rejects(reloading, {code: 'STUDIO_DISK_OBSERVATION_STALE'});
    assert.equal(disk.getVersion(uri), 1);
    assert.notEqual(documents.get(uri).text, 'external');
  }
});

test('A19 declined confirmation and read-only models leave both document and disk baselines intact', async t => {
  const context = await diskObservationContext(t, {confirm: () => false});
  const {uri, documents, observer, disk} = context;
  documents.update(uri, 'unsaved');
  context.external('external');
  const observed = await observer.read(uri);
  assert.equal(await context.reload(observed), false);
  assert.equal(documents.get(uri).text, 'unsaved');
  assert.equal(documents.get(uri).dirty, true);
  context.confirm = () => true;
  documents.models.get(uri).setReadOnly(true);
  await assert.rejects(context.reload(observed), /read.?only/i);
  assert.equal(documents.get(uri).text, 'unsaved');
  assert.equal(disk.getVersion(uri), 1);
});

test('A19 disk changes occurring after a prompt are rechecked before changing the editor', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, documents, disk} = context;
  context.external('external');
  const observed = await observer.read(uri);
  context.external('different');
  await assert.rejects(context.reload(observed), {code: 'SFPROJECT_DISK_OBSERVATION_STALE'});
  assert.equal(documents.get(uri).text, 'original');
  assert.equal(disk.getVersion(uri), 1);
  const newest = await observer.read(uri);
  await context.reload(newest);
  assert.equal(documents.get(uri).text, 'different');
});

test('A19 postcommit listener errors report committed state and preserve the matching save baseline', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, documents, disk} = context;
  context.external('external');
  const observed = await observer.read(uri);
  const dispose = documents.subscribe(event => { if (event.type === 'saved') throw new Error('notification failed'); });
  await assert.rejects(context.reload(observed), error => error.code === 'DOCUMENT_COMMITTED' && error.committed === true);
  dispose();
  assert.equal(documents.get(uri).text, 'external');
  assert.equal(documents.get(uri).dirty, false);
  assert.equal(disk.getVersion(uri), 2);
  documents.update(uri, 'next');
  await disk.save([documents.captureSave(uri)]);
});

test('A19 disposed and cancelled observers do not publish a pending handle read or reload prompt', async t => {
  for (const cancel of ['signal', 'dispose']) {
    const context = await diskObservationContext(t);
    const {uri, observer, documents} = context;
    const entered = deferred();
    const gate = deferred();
    const source = sourceFileHandle(uri, 'pending');
    const handle = {async getFile() { entered.resolve(); await gate.promise; return source.getFile(); }};
    context.target = new DiskWorkspace([{path: uri, text: 'original'}], new Map([[uri, handle]]));
    const controller = new AbortController();
    const reading = observer.read(uri, {signal: controller.signal});
    await entered.promise;
    if (cancel === 'signal') controller.abort(); else observer.dispose();
    gate.resolve();
    await assert.rejects(reading, {name: 'AbortError'});
    assert.equal(documents.get(uri).text, 'original');
    assert.equal(source.reads.length, 0);
  }
});

test('A19 a replaced target or record during decoding returns no stale observation', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, documents} = context;
  const entered = deferred();
  const gate = deferred();
  const handle = {async getFile() { entered.resolve(); await gate.promise; return new SlicedFile(['external'], uri); }};
  context.target = new DiskWorkspace([{path: uri, text: 'original'}], new Map([[uri, handle]]));
  const reading = observer.read(uri);
  await entered.promise;
  documents.replace([{uri, text: 'replacement', version: 1}], {discard: true});
  gate.resolve();
  assert.equal(await reading, null);
  assert.equal(documents.get(uri).text, 'replacement');
});

test('A19 cancellation during a decoded chunk prevents observation publication and leaves the document unchanged', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, documents} = context;
  const controller = new AbortController();
  const file = new Blob(['x'.repeat(300_000)]);
  const reads = [];
  const watched = {size: file.size, slice(start, end) {
    reads.push({start, end});
    return {async arrayBuffer() {
      const bytes = await file.slice(start, end).arrayBuffer();
      if (end > 3) controller.abort();
      return bytes;
    }};
  }};
  const handle = {async getFile() { return watched; }};
  context.target = new DiskWorkspace([{path: uri, text: 'original'}], new Map([[uri, handle]]), 'Cancelled', [], [], observationLimits);
  await assert.rejects(observer.read(uri, {signal: controller.signal}), {name: 'AbortError'});
  assert.deepEqual(reads, [{start: 0, end: 3}, {start: 0, end: 256 * 1024}]);
  assert.equal(documents.get(uri).text, 'original');
});

test('A19 watch reads admit exactly 8,000,000 decoded characters and reject larger or invalid encodings', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, handle, documents} = context;
  const limit = 8_000_000;
  context.external('x'.repeat(limit));
  const observed = await observer.read(uri);
  assert.equal(observed.text.length, limit);
  context.external('x'.repeat(limit + 1));
  await assert.rejects(observer.read(uri), /character limit/);
  handle.setExternal(new Uint8Array([0xc3, 0x28]));
  await assert.rejects(observer.read(uri), TypeError);
  handle.setExternal(new Uint8Array([65, 0, 66]));
  await assert.rejects(observer.read(uri), {code: 'SFEDITOR_SOURCE_BINARY'});
  assert.equal(documents.get(uri).text, 'original');
});

test('A19 automatic reads reject an oversized byte descriptor without slicing or reading lazy editor text', async t => {
  const context = await diskObservationContext(t);
  const {uri, observer, documents} = context;
  let slices = 0;
  const handle = {async getFile() { return {size: 24_000_004, slice() { slices++; throw new Error('must not slice'); }}; }};
  context.target = new DiskWorkspace([{path: uri, text: 'original'}], new Map([[uri, handle]]), 'Large', [], [], observationLimits);
  await assert.rejects(observer.read(uri), /encoded byte limit/);
  assert.equal(slices, 0);
  const record = documents.get(uri);
  Object.defineProperty(record, 'text', {get() { throw new Error('lazy source was materialized'); }});
  documents.models.get(uri).applyEdits([{start: 0, end: 8, text: 'x'.repeat(8_000_001)}]);
  await assert.rejects(observer.read(uri), /automatic disk observation limit/);
  assert.equal(slices, 0);
});
