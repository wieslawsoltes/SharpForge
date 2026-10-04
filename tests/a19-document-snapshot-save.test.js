import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { PieceTable } from '@sharpforge/text';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { deferred } from './a19-session-fixtures.js';

function document(saveDocument) {
  const table = new PieceTable('', { uri: 'Large.cs', version: 4 });
  for (let index = 0; index < 32; index++) table.insert(table.length, `${'x'.repeat(65_000)}\n`);
  const model = new EditorModel(table.snapshot().withMetadata({ uri: 'Large.cs', version: 4 }), { uri: 'Large.cs', version: 4 });
  const record = { uri: 'Large.cs', version: 4, encoding: 'utf-16le', bom: true, nativeHash: 'original' };
  Object.defineProperties(record, {
    model: { value: model }, source: { value: model.snapshot() },
    text: { enumerable: true, get() { throw new Error('Prepared input text must remain lazy'); } }
  });
  const documents = new DocumentService({ records: [record], saveDocument });
  return { documents, model, original: model.snapshot() };
}

test('an unchanged captured source save marks the exact model revision clean without materializing text', async () => {
  let written;
  const { documents, model } = document(snapshot => { written = snapshot; return true; });
  model.applyEdits([{ start: 0, end: 0, text: 'edited' }]);
  const captured = model.snapshot();
  assert.equal(await documents.save('Large.cs'), true);
  assert.equal(written.source, captured);
  assert.equal(written.version, captured.version);
  assert.equal(written.length, captured.length);
  assert.equal(written.encoding, 'utf-16le');
  assert.equal(written.bom, true);
  assert.equal(written.nativeHash, 'original');
  assert.equal(Object.isFrozen(written), true);
  assert.equal(Object.getOwnPropertyDescriptor(written, 'source').enumerable, false);
  assert.equal(typeof Object.getOwnPropertyDescriptor(written, 'text').get, 'function');
  assert.equal('model' in written || 'originalSource' in written, false);
  assert.equal(model.isDirty, false);
  assert.equal(documents.baselines.get('Large.cs'), captured);
  assert.equal(captured.statistics.textMaterialized, false);
  documents.dispose();
});

test('edits during pending source I/O retain the written snapshot baseline and never mark the new revision clean', async () => {
  const pending = deferred();
  let written;
  const { documents, model } = document(snapshot => { written = snapshot; return pending.promise; });
  model.applyEdits([{ start: 0, end: 0, text: 'written' }]);
  const saving = documents.save('Large.cs');
  const captured = written.source;
  model.applyEdits([{ start: 0, end: 0, text: 'new edit' }]);
  const current = model.snapshot();
  pending.resolve(true);
  assert.equal(await saving, false);
  assert.equal(documents.baselines.get('Large.cs'), captured);
  assert.equal(documents.staleSaves.has('Large.cs'), true);
  assert.equal(documents.get('Large.cs').dirty, true);
  assert.equal(written.source.getText(0, 7), 'written');
  assert.equal(written.version, captured.version);
  assert.equal(captured.statistics.textMaterialized, false);
  assert.equal(current.statistics.textMaterialized, false);
  documents.dispose();
});

test('captureSave supports bulk snapshot consumers and reads captured text only on a legacy provider request', () => {
  const { documents, model } = document();
  model.applyEdits([{ start: 0, end: 0, text: 'captured' }]);
  const captured = documents.captureSave('Large.cs');
  const source = captured.source;
  model.applyEdits([{ start: 0, end: 0, text: 'later' }]);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(captured.text.slice(0, 8), 'captured');
  assert.equal(source.statistics.textMaterialized, true);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  assert.equal(documents.markSaved('Large.cs', captured), false);
  assert.equal(documents.baselines.get('Large.cs'), source);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  documents.dispose();
});

test('failed or rejected writes retain the previous baseline and dirty state', async () => {
  const { documents, model, original } = document(() => false);
  model.applyEdits([{ start: 0, end: 0, text: 'not saved' }]);
  assert.equal(await documents.save('Large.cs'), false);
  assert.equal(documents.baselines.get('Large.cs'), original);
  documents.saveDocument = async () => { throw new Error('write failed'); };
  await assert.rejects(documents.save('Large.cs'), /write failed/);
  assert.equal(documents.baselines.get('Large.cs'), original);
  assert.equal(model.isDirty, true);
  assert.equal(documents.get('Large.cs').dirty, true);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  documents.dispose();
});

test('a captured save cannot overwrite a replacement document baseline after asynchronous I/O', async () => {
  const pending = deferred();
  const { documents, model } = document(() => pending.promise);
  model.applyEdits([{ start: 0, end: 0, text: 'saving' }]);
  const captured = model.snapshot();
  const saving = documents.save('Large.cs');
  const next = new EditorModel('replacement', { uri: 'Large.cs', version: 22 });
  documents.replace([{ uri: 'Large.cs', model: next, source: next.snapshot(), version: 22 }], { discard: true });
  pending.resolve(true);
  assert.equal(await saving, false);
  assert.equal(documents.baselines.get('Large.cs'), next.snapshot());
  assert.equal(documents.get('Large.cs').dirty, false);
  assert.equal(captured.statistics.textMaterialized, false);
  assert.equal(next.snapshot().statistics.textMaterialized, false);
  documents.dispose();
});

test('saved snapshot validation rejects foreign or mismatched sources before considering lazy text', () => {
  const { documents, model, original } = document();
  const invalid = [null, model.snapshot().withMetadata({ uri: 'Other.cs' }), model.snapshot().withMetadata({ version: 999 }), {}];
  for (const source of invalid) {
    const saved = { source, version: model.version, get text() { throw new Error('Do not read fallback text'); } };
    assert.throws(() => documents.markSaved('Large.cs', saved), /immutable snapshot matching/);
    assert.equal(documents.baselines.get('Large.cs'), original);
    assert.equal(documents.get('Large.cs').dirty, false);
  }
  documents.dispose();
});
