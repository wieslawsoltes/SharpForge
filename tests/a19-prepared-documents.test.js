import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel, readEditorSource } from '@sharpforge/editor';
import { PieceTable } from '@sharpforge/text';
import { DocumentService } from '../apps/studio/workbench/documents.js';

function prepared(path, { model, version = 3, chunks = 16 } = {}) {
  if (!model) {
    const table = new PieceTable('', { uri: path, version });
    for (let index = 0; index < chunks; index++) table.insert(table.length, `// chunk ${index}\n${'x'.repeat(65_000)}\n`);
    const source = table.snapshot().withMetadata({ uri: path, version });
    model = new EditorModel(source, { uri: path, version });
  }
  let textReads = 0;
  const record = { path, version: model.version, encoding: 'utf-8', bom: false, byteLength: model.length };
  Object.defineProperties(record, {
    model: { value: model, enumerable: false, configurable: true },
    source: { value: model.snapshot(), enumerable: false, configurable: true },
    originalSource: { value: model.snapshot(), enumerable: false, configurable: true },
    length: { value: model.length, enumerable: false, configurable: true },
    text: { enumerable: true, configurable: true, get() { textReads++; throw new Error('Prepared input text must stay lazy'); } }
  });
  return { record, model, source: model.snapshot(), get textReads() { return textReads; } };
}

const factory = record => new EditorModel(record.text, { uri: record.uri, version: record.version });
const original = () => new DocumentService({ records: [{ uri: 'Original.cs', text: 'original', version: 1 }], createModel: factory });
const usable = model => model.applyEdits([{ start: 0, end: 0, text: 'kept' }]);

test('prepared document ingress adopts the exact model and source without reading text or rebuilding it', () => {
  const input = prepared('Large.cs');
  let factories = 0;
  const documents = new DocumentService({ records: [input.record], createModel: () => { factories++; throw new Error('Already prepared'); } });
  const record = documents.get('Large.cs');
  assert.equal(factories, 0);
  assert.equal(documents.models.get('Large.cs'), input.model);
  assert.equal(documents.baselines.get('Large.cs'), input.source);
  assert.equal(record.uri, input.record.path);
  assert.equal(record.model, input.model);
  assert.equal(record.source, input.source);
  assert.equal(record.length, input.model.length);
  assert.equal(record.dirty, false);
  assert.equal(input.textReads, 0);
  assert.equal(input.source.statistics.textMaterialized, false);
  input.model.applyEdits([{ start: 0, end: 0, text: '// edited\n' }]);
  assert.equal(record.version, 4);
  assert.equal(record.length, input.source.length + 10);
  assert.equal(record.dirty, true);
  assert.equal(input.source.statistics.textMaterialized, false);
  assert.equal(input.model.snapshot().statistics.textMaterialized, false);
  assert.equal(documents.baselines.get(record.uri), input.source);
  documents.dispose();
});

test('model and immutable roots are hidden even when an incoming caller made them enumerable', () => {
  const input = prepared('Export.cs', { chunks: 1 });
  for (const key of ['model', 'source', 'originalSource']) Object.defineProperty(input.record, key, { enumerable: true });
  const documents = new DocumentService({ records: [input.record] });
  const record = documents.get('Export.cs');
  for (const key of ['model', 'source', 'originalSource']) assert.equal(Object.getOwnPropertyDescriptor(record, key).enumerable, false);
  assert.equal(input.textReads, 0);
  const copied = { ...record };
  for (const key of ['model', 'source', 'originalSource']) assert.equal(key in copied, false);
  const json = JSON.parse(JSON.stringify(record));
  assert.equal(typeof json.text, 'string');
  assert.equal(json.uri, 'Export.cs');
  assert.equal('model' in json || 'source' in json || 'originalSource' in json, false);
  assert.equal(input.textReads, 0, 'Explicit user export reads the adopted model, never the original input getter');
  documents.dispose();
});

test('retaining prepared records preserves model/map/view identity and replaces old subscriptions without materializing text', () => {
  const input = prepared('Shared.cs');
  const editor = { element: {}, model: null, disposed: false,
    setModel(uri, model) { assert.equal(this.disposed, false); this.model = model; }, dispose() { this.disposed = true; } };
  const documents = new DocumentService({ records: [input.record], createEditor: () => editor });
  documents.createDocument('Shared.cs');
  input.model.applyEdits([{ start: 0, end: 0, text: 'new' }]);
  const modelMap = documents.models;
  documents.replace(documents.files, { discard: true, preserveEditors: true });
  assert.equal(documents.models, modelMap);
  assert.equal(documents.models.get('Shared.cs'), input.model);
  assert.equal(editor.model, input.model);
  assert.equal(editor.disposed, false);
  assert.equal(documents.get('Shared.cs').dirty, false);
  assert.equal(input.model.isDirty, false);
  assert.equal(input.model.snapshot().statistics.textMaterialized, false);
  let changes = 0;
  documents.subscribe(event => { if (event.type === 'changed') changes++; });
  input.model.applyEdits([{ start: 0, end: 0, text: 'again' }]);
  assert.equal(changes, 1);
  documents.dispose();
});

test('duplicate, mismatched and stale prepared records reject atomically and remain caller-owned', () => {
  const mutations = [
    value => [value.record, value.record],
    value => [Object.defineProperty(value.record, 'uri', { value: 'Wrong.cs', configurable: true })],
    value => [Object.defineProperty(value.record, 'version', { value: 999, configurable: true })],
    value => [Object.defineProperty(value.record, 'length', { value: 999, configurable: true })],
    value => { usable(value.model); return [value.record]; }
  ];
  for (let index = 0; index < mutations.length; index++) {
    const documents = original();
    const previous = documents.models.get('Original.cs');
    const input = prepared('Incoming.cs', { chunks: 1 });
    const records = mutations[index](input);
    assert.throws(() => documents.replace(records, { discard: true }));
    assert.equal(documents.models.get('Original.cs'), previous);
    assert.equal(documents.ownsModel(input.model), false);
    assert.doesNotThrow(() => usable(input.model));
    assert.equal(input.textReads, 0);
    documents.dispose();
    input.model.dispose();
  }
});

test('a failed factory disposes only models it created while prepared callers and the current workspace remain intact', () => {
  const documents = original();
  const input = prepared('Prepared.cs', { chunks: 1 });
  const created = [];
  documents.modelFactory = record => {
    if (record.uri === 'Fail.cs') throw new Error('Factory failed');
    const model = factory(record);
    created.push(model);
    return model;
  };
  assert.throws(() => documents.replace([input.record, { uri: 'New.cs', text: 'new' }, { uri: 'Fail.cs', text: 'fail' }]), /Factory failed/);
  assert.throws(() => usable(created[0]), /disposed/);
  assert.doesNotThrow(() => usable(input.model));
  assert.equal(documents.get('Original.cs').text, 'original');
  assert.equal(documents.models.size, 1);
  documents.dispose();
  input.model.dispose();
});

test('subscription failure and cancellation release staged subscriptions without disposing prepared input models', () => {
  class TrackedModel extends EditorModel {
    observers = 0;
    onDidChange(listener) {
      if (this.fail) throw new Error('Subscription failed');
      this.observers++;
      const release = super.onDidChange(listener);
      return () => { this.observers--; release(); };
    }
  }
  const documents = original();
  const first = prepared('First.cs', { model: new TrackedModel('first', { uri: 'First.cs' }) });
  const second = prepared('Second.cs', { model: new TrackedModel('second', { uri: 'Second.cs' }) });
  second.model.fail = true;
  assert.throws(() => documents.replace([first.record, second.record]), /Subscription failed/);
  assert.equal(first.model.observers, 0);
  const controller = new AbortController();
  let created;
  documents.modelFactory = record => { created = factory(record); controller.abort(); return created; };
  assert.throws(() => documents.replace([first.record, { uri: 'Factory.cs', text: 'created' }], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(first.model.observers, 0);
  assert.throws(() => usable(created), /disposed/);
  assert.doesNotThrow(() => usable(first.model));
  assert.doesNotThrow(() => usable(second.model));
  documents.dispose();
  first.model.dispose();
  second.model.dispose();
});

test('saved-state preparation rolls back dirty caller models if another model cannot commit its saved marker', () => {
  class FailedSavedMarker extends EditorModel {
    markSaved() { throw new Error('Saved marker failed'); }
  }
  const firstModel = new EditorModel('first', { uri: 'First.cs' });
  const secondModel = new FailedSavedMarker('second', { uri: 'Second.cs' });
  usable(firstModel);
  usable(secondModel);
  const first = prepared('First.cs', { model: firstModel });
  const second = prepared('Second.cs', { model: secondModel });
  const documents = original();
  assert.throws(() => documents.replace([first.record, second.record]), /Saved marker failed/);
  assert.equal(firstModel.isDirty, true);
  assert.equal(secondModel.isDirty, true);
  assert.equal(firstModel.snapshot(), first.source);
  assert.equal(documents.models.size, 1);
  assert.equal(documents.ownsModel(firstModel), false);
  documents.dispose();
  firstModel.dispose();
  secondModel.dispose();
});

test('add and legacy appended-record lookup adopt prepared models without a factory, and dispose releases owned roots', () => {
  const documents = new DocumentService();
  const added = prepared('Added.cs', { chunks: 1 });
  const appended = prepared('Appended.cs', { chunks: 1 });
  documents.add(added.record);
  documents.files.push(appended.record);
  assert.equal(documents.get('Appended.cs').model, appended.model);
  assert.equal(documents.files.length, 2);
  assert.equal(documents.models.size, 2);
  assert.equal(added.textReads + appended.textReads, 0);
  assert.equal(appended.source.statistics.textMaterialized, false);
  assert.equal(documents.ownsModel(added.model), true);
  documents.dispose();
  assert.equal(documents.baselines.size, 0);
  assert.equal(documents.files.length, 0);
  assert.throws(() => usable(added.model), /disposed/);
  assert.throws(() => usable(appended.model), /disposed/);
});

test('view errors after the atomic ownership commit are explicit and do not hand live models back to callers', () => {
  const documents = original();
  const input = prepared('Committed.cs', { chunks: 1 });
  documents.subscribe(event => { if (event.type === 'reset') throw new Error('View could not refresh'); });
  assert.throws(() => documents.replace([input.record]), { code: 'DOCUMENT_COMMITTED', committed: true });
  assert.equal(documents.ownsModel(input.model), true);
  assert.equal(documents.get('Committed.cs').model, input.model);
  assert.doesNotThrow(() => usable(input.model));
  documents.dispose();
});

test('real chunked File ingress adopts the reader model and decoder metadata without invoking whole-source getters', async () => {
  class SlicedFile extends File {
    reads = [];
    async text() { throw new Error('No full text read'); }
    async arrayBuffer() { throw new Error('No full byte read'); }
    slice(start, end) { this.reads.push(end - start); return super.slice(start, end); }
  }
  const text = '// 日本語 😀 e\u0301\r\n'.repeat(3_000);
  const file = new SlicedFile([new Uint8Array([239, 187, 191]), text], 'Unicode.cs');
  const record = await readEditorSource(file, { uri: 'src/Unicode.cs', version: 41, chunkSize: 8191 });
  const source = record.source;
  const documents = new DocumentService({ createModel() { throw new Error('Reader model already exists'); } });
  documents.replace([record]);
  const adopted = documents.get('src/Unicode.cs');
  assert.equal(adopted.model, record.model);
  assert.equal(adopted.source, source);
  assert.equal(adopted.version, 41);
  assert.equal(adopted.encoding, 'utf-8');
  assert.equal(adopted.bom, true);
  assert.equal(adopted.byteLength, file.size);
  assert.equal(adopted.length, text.length);
  assert.equal(adopted.model.getText(0, 10), text.slice(0, 10));
  assert(file.reads.every(bytes => bytes <= 8191));
  assert.equal(source.statistics.textMaterialized, false);
  documents.dispose();
});

test('append imports retain dirty model baselines and read-only state without implicitly saving existing documents', () => {
  const input = prepared('Existing.cs', { chunks: 1 });
  const documents = new DocumentService({ records: [input.record] });
  input.model.applyEdits([{ start: 0, end: 0, text: 'unsaved' }]);
  input.model.readOnly = true;
  const incoming = prepared('Imported.cs', { chunks: 1 });
  documents.replace([...documents.files, incoming.record], { preserveEditors: true, preserveDirty: true });
  assert.equal(documents.baselines.get('Existing.cs'), input.source);
  assert.equal(documents.get('Existing.cs').dirty, true);
  assert.equal(documents.dirtyFiles.has('Existing.cs'), true);
  assert.equal(input.model.isDirty, true);
  assert.equal(input.model.readOnly, true);
  assert.equal(documents.get('Imported.cs').dirty, false);
  assert.equal(input.model.snapshot().statistics.textMaterialized, false);
  input.model.readOnly = false;
  input.model.undo();
  assert.equal(documents.get('Existing.cs').dirty, false, 'The original saved undo position was retained');
  documents.dispose();
});

test('append imports retain a late-save snapshot baseline and its stale-save dirty marker', () => {
  const input = prepared('Existing.cs', { chunks: 1 });
  const documents = new DocumentService({ records: [input.record] });
  input.model.applyEdits([{ start: 0, end: 0, text: 'saved revision' }]);
  const captured = input.model.snapshot();
  input.model.applyEdits([{ start: 0, end: 0, text: 'new edit' }]);
  documents.markSaved('Existing.cs', { source: captured, version: captured.version });
  documents.replace(documents.files, { preserveDirty: true });
  assert.equal(documents.baselines.get('Existing.cs'), captured);
  assert.equal(documents.staleSaves.has('Existing.cs'), true);
  assert.equal(documents.get('Existing.cs').dirty, true);
  assert.equal(captured.statistics.textMaterialized, false);
  assert.equal(input.model.snapshot().statistics.textMaterialized, false);
  documents.dispose();
});

test('preserveDirty never permits replacing or removing a dirty model without explicit discard', () => {
  const input = prepared('Existing.cs', { chunks: 1 });
  const documents = new DocumentService({ records: [input.record] });
  usable(input.model);
  const replacement = prepared('Existing.cs', { chunks: 1 });
  assert.throws(() => documents.replace([], { preserveDirty: true }), { code: 'DOCUMENT_DIRTY' });
  assert.throws(() => documents.replace([replacement.record], { preserveDirty: true }), { code: 'DOCUMENT_DIRTY' });
  assert.equal(documents.ownsModel(input.model), true);
  assert.equal(documents.ownsModel(replacement.model), false);
  assert.doesNotThrow(() => replacement.model.prepareEdits([]));
  documents.replace([replacement.record], { preserveDirty: true, discard: true });
  assert.equal(documents.get('Existing.cs').dirty, false);
  assert.equal(documents.baselines.get('Existing.cs'), replacement.source);
  assert.throws(() => usable(input.model), /disposed/);
  documents.dispose();
});

test('disposed prepared models reject and failing view cleanup still releases all owned models and roots', () => {
  const documents = original();
  const rejected = prepared('Disposed.cs', { chunks: 1 });
  rejected.model.readOnly = true;
  rejected.model.dispose();
  assert.throws(() => documents.replace([rejected.record]), /disposed/);
  let secondDisposed = false;
  documents.attachEditor('Original.cs', { element: {}, dispose() { throw new Error('First view failed'); } });
  documents.attachEditor('Original.cs', { element: {}, dispose() { secondDisposed = true; } }, { viewId: 'second' });
  const owned = documents.models.get('Original.cs');
  assert.throws(() => documents.dispose(), { code: 'DOCUMENT_COMMITTED', committed: true });
  assert.equal(secondDisposed, true);
  assert.equal(documents.models.size, 0);
  assert.equal(documents.baselines.size, 0);
  assert.equal(documents.views.size, 0);
  assert.equal(documents.viewStates.size, 0);
  assert.throws(() => usable(owned), /disposed/);
  assert.doesNotThrow(() => documents.dispose());
});
