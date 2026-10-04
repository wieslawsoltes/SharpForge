import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, rebaseEditorSource} from '@sharpforge/editor';
import {DiskWorkspace, encodeWorkspaceFile, writeWorkspaceSource} from '@sharpforge/project-system';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {saveStudioSourceAs} from '../apps/studio/workbench/source-save-as.js';
import {sourceFileHandle} from './fixtures/a20-source-file-fixture.js';

const limits = {maxFileBytes: 1024 * 1024, maxAssemblyBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024};

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`A20 Save As without a ${encoding} BOM retains the encoding on both later baseline checks`, async () => {
    const model = new EditorModel('class C { string Text = "😀界"; }\r\n', {uri: 'Program.cs', encoding, bom: false});
    const handle = sourceFileHandle('Program.cs', 'old output');
    const source = model.snapshot();
    const result = await saveStudioSourceAs({uri: model.uri, version: model.version, source, encoding, bom: false}, {
      window: {showSaveFilePicker: async () => handle}
    });
    assert.equal(result.ok, true);
    assert.equal(result.bom, false);
    const requested = [];
    const disk = new DiskWorkspace([{path: model.uri, source, encoding, bom: false, byteLength: result.byteLength}],
      new Map([[model.uri, handle]]), 'Chosen source', [], [], {...limits,
        readSource(file, options) {
          requested.push(options.encoding);
          return readStudioSource(file, options);
        }});
    for (const text of ['// second\n', '// third\n']) {
      model.applyEdits([{start: model.length, end: model.length, text}]);
      const saved = model.snapshot();
      await disk.save([{uri: model.uri, source: saved, expectedVersion: disk.getVersion(model.uri)}]);
      assert.equal(disk.baseline.get(model.uri), saved);
      const actual = new TextDecoder(encoding, {fatal: true}).decode(handle.bytes);
      assert.equal(actual, model.getText());
    }
    assert.deepEqual(requested, [encoding, encoding, encoding, encoding]);
    assert.equal(handle.metrics.written, 3);
    assert.equal(source.statistics.textMaterialized, false);
    model.dispose();
  });

  test(`A20 ${encoding} output refuses unpaired surrogates before closing or downloading`, async () => {
    for (const invalid of ['\ud800', '\udc00', '\ud800x', '\ud800\ud800', '\udc00\udc00']) {
      const text = 'a'.repeat(65_536) + invalid;
      const model = new EditorModel(text, {uri: 'Invalid.cs', encoding});
      const handle = sourceFileHandle('Invalid.cs', 'unchanged');
      let downloads = 0;
      const captured = {uri: model.uri, version: model.version, source: model.snapshot(), encoding, bom: false};
      await assert.rejects(saveStudioSourceAs(captured, {
        window: {showSaveFilePicker: async () => handle}, download() { downloads++; }
      }), error => error.code === 'SFPROJECT_SOURCE_ENCODING_LOSS' && error.start === 65_536
        && error.path === 'Invalid.cs' && error.severity === 'error');
      assert.equal(handle.metrics.written, 0);
      assert.equal(handle.metrics.aborted, 1);
      assert.equal(new TextDecoder().decode(handle.bytes), 'unchanged');
      assert.equal(downloads, 0);
      await assert.rejects(saveStudioSourceAs(captured, {window: {}, download() { downloads++; }}), {
        code: 'SFPROJECT_SOURCE_ENCODING_LOSS'
      });
      assert.equal(downloads, 0);
      model.dispose();
    }
  });

  test(`A20 ${encoding} disk preflight rejects lossy captured and legacy input before opening a stream`, async () => {
    const original = 'valid source';
    const bytes = encodeWorkspaceFile({path: 'A.cs', text: original, encoding, bom: true});
    const handle = sourceFileHandle('A.cs', bytes);
    const prepared = await readStudioSource(await handle.getFile(), {path: 'A.cs', limits});
    const disk = new DiskWorkspace([prepared], new Map([['A.cs', handle]]), 'Source', [], [], {...limits, readSource: readStudioSource});
    const baseline = disk.baseline.get('A.cs');
    prepared.model.applyEdits([{start: 0, end: 0, text: '\ud800'}]);
    for (const change of [{source: prepared.model.snapshot()}, {text: '\udc00'}]) {
      await assert.rejects(disk.save([{path: 'A.cs', ...change}]), {code: 'SFPROJECT_SOURCE_ENCODING_LOSS'});
      assert.equal(disk.baseline.get('A.cs'), baseline);
      assert.equal(disk.getVersion('A.cs'), 1);
      assert.equal(handle.metrics.opened, 0);
      assert.equal(handle.metrics.written, 0);
      assert.deepEqual(handle.bytes, bytes);
    }
    prepared.model.dispose();
  });
}

test('A20 direct source output reports a boundary high surrogate and leaves abort/close ownership to its caller', async () => {
  const calls = [];
  const stream = {async write() { calls.push('write'); }, async abort() { calls.push('abort'); }, async close() { calls.push('close'); }};
  await assert.rejects(writeWorkspaceSource(stream, 'a'.repeat(65_535) + '\ud800x', {path: 'Boundary.cs'}), {
    code: 'SFPROJECT_SOURCE_ENCODING_LOSS', start: 65_535, length: 1
  });
  assert.deepEqual(calls, []);
});

test('A20 the default disk reader retains an explicitly known no-BOM UTF-16 baseline', async () => {
  for (const encoding of ['utf-16le', 'utf-16be']) {
    let bytes = encodeWorkspaceFile({path: 'A.cs', text: 'original', encoding, bom: false});
    const handle = {
      async getFile() { return new File([bytes], 'A.cs'); },
      async createWritable() {
        let next;
        return {async write(value) { next = value; }, async close() { bytes = next; }, async abort() {}};
      }
    };
    const disk = new DiskWorkspace([{path: 'A.cs', text: 'original', encoding, bom: false}], new Map([['A.cs', handle]]));
    await disk.save([{path: 'A.cs', text: 'second'}]);
    await disk.save([{path: 'A.cs', text: 'third'}]);
    assert.equal(new TextDecoder(encoding, {fatal: true}).decode(bytes), 'third');
  }
});

test('A20 source output rejects NUL and an ambiguous leading BOM character without committing or downloading', async () => {
  for (const text of ['x\0y', '\ufeffsource']) {
    for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
      const model = new EditorModel(text, {uri: 'A.cs', encoding, bom: false});
      const handle = sourceFileHandle('A.cs', 'unchanged');
      await assert.rejects(saveStudioSourceAs({uri: model.uri, source: model.snapshot(), version: model.version, encoding, bom: false}, {
        window: {showSaveFilePicker: async () => handle}
      }), {code: 'SFPROJECT_SOURCE_ENCODING_LOSS'});
      assert.equal(handle.metrics.written, 0);
      assert.equal(handle.metrics.aborted, 1);
      model.dispose();
    }
  }
  const handle = sourceFileHandle('A.cs', 'old');
  const result = await saveStudioSourceAs({uri: 'A.cs', text: '\ufeffsource', encoding: 'utf-8', bom: true}, {
    window: {showSaveFilePicker: async () => handle}
  });
  assert.equal(result.ok, true);
  assert.equal(new TextDecoder('utf-8', {fatal: true}).decode(handle.bytes), '\ufeffsource');
});

test('A20 rebasing retains the old encoded-byte baseline when the prepared source has changed', async () => {
  const record = await readStudioSource(new File(['original'], 'A.cs'), {path: 'A.cs'});
  const original = record.source;
  record.model.applyEdits([{start: record.model.length, end: record.model.length, text: ' later'}]);
  record.source = record.model.snapshot();
  const rebased = rebaseEditorSource(record, 'src/A.cs');
  assert.notEqual(rebased.originalSource, rebased.source);
  assert.equal(rebased.originalSource.uri, 'src/A.cs');
  assert.equal(rebased.originalSource.getText(), 'original');
  assert.equal(rebased.byteLength, 8);
  assert.equal(rebased.source.length, 14);
  assert.equal(record.originalSource, original);
  assert.equal(record.model.uri, 'A.cs');
  assert.equal(rebased.source.statistics.textMaterialized, false);
  delete record.originalSource;
  const unknown = rebaseEditorSource(record, 'Unknown.cs');
  assert.equal(unknown.originalSource, undefined);
  assert.notEqual(unknown.originalSource, unknown.source);
  record.model.dispose();
  rebased.model.dispose();
  unknown.model.dispose();
});

test('A20 unchanged rebasing keeps a provably current byte baseline without reading text', async () => {
  const record = await readStudioSource(new File(['original'], 'A.cs'), {path: 'A.cs'});
  const rebased = rebaseEditorSource(record, 'src/A.cs');
  assert.equal(rebased.source, rebased.originalSource);
  assert.equal(rebased.byteLength, record.byteLength);
  assert.equal(rebased.source.statistics.textMaterialized, false);
  record.model.dispose();
  rebased.model.dispose();
});
