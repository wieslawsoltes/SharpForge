import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {createStudioWorkspacePorts} from '../apps/studio/workbench/studio-workspace-ports.js';

function fixture(records = []) {
  const state = {name: 'Fixture', nativeMode: false, revision: 1, files: [], extraFiles: records,
    tabs: [], folders: [], dirtyFiles: new Set()};
  const documents = new DocumentService();
  const messages = [];
  let rendered = 0;
  const host = {
    state, documents, actions: {}, window: {}, nativeBuild: {},
    context: () => ({identity: 'fixture:1', revision: state.revision, disk: state.disk,
      records: state.extraFiles, folders: [], settings: {name: 'Fixture', mode: 'folder'}}),
    renderWorkspace: () => rendered++, toast: (...args) => messages.push(args),
    storage: {getItem: () => null}, storageKey: 'fixture',
    load: (input, options) => ({records: input, options})
  };
  return {host, state, documents, messages, rendered: () => rendered};
}

test('workspace source admission retains the prepared model and is idempotent for an open document', async () => {
  const model = new EditorModel('class Closed {}', {uri: 'Closed.cs', version: 8});
  const record = {path: 'Closed.cs', version: 8, encoding: 'utf-16le', originalText: 'class Closed {}', byteLength: 30};
  let textReads = 0;
  Object.defineProperties(record, {
    model: {value: model}, source: {value: model.snapshot()}, originalSource: {value: model.snapshot()},
    length: {value: model.length},
    text: {enumerable: true, get() {
      textReads++;
      throw new Error('Prepared source text must stay lazy');
    }}
  });
  const current = fixture([record]);
  const ports = createStudioWorkspacePorts(current.host);
  try {
    const admitted = await ports.ensureSource('Closed.cs');
    assert.equal(current.documents.models.get('Closed.cs'), model);
    assert.equal(admitted.encoding, 'utf-16le');
    assert.equal(admitted.originalText, record.originalText);
    assert.equal(admitted.version, 8);
    assert.equal(await ports.ensureSource('Closed.cs'), admitted);
    assert.equal(current.documents.files.length, 1);
    assert.equal(current.rendered(), 1);
    assert.equal(model.setReadOnly(model.readOnly), false, 'the adopted model remains live');
    assert.equal(admitted.source, model.snapshot());
    assert.equal(textReads, 0);
  } finally { current.documents.dispose(); }
  assert.throws(() => model.setReadOnly(false), /disposed/, 'the document owner disposes its adopted model');
});

test('source admission rejects cancellation, unavailable sources and workspace changes before model adoption', async () => {
  const current = fixture([{path: 'Closed.cs', lazy: true, size: 15, version: 1}]);
  let finish;
  current.state.disk = {load: async (_path, {beforeAdmit}) => {
    await new Promise(resolve => { finish = resolve; });
    beforeAdmit();
    return {path: 'Closed.cs', text: 'class Closed {}', version: 2};
  }};
  const ports = createStudioWorkspacePorts(current.host);
  try {
    const pending = ports.ensureSource('Closed.cs');
    current.state.revision++;
    finish();
    await assert.rejects(pending, /Workspace changed/);
    assert.equal(current.documents.files.length, 0);
    const controller = new AbortController();
    controller.abort(new Error('cancelled source request'));
    await assert.rejects(ports.ensureSource('Closed.cs', {signal: controller.signal}), /cancelled source request/);
    await assert.rejects(ports.ensureSource('Missing.cs'), /Source is unavailable/);
    current.state.extraFiles.push({path: 'Asset.bin', bytes: new Uint8Array([0, 255])});
    await assert.rejects(ports.ensureSource('Asset.bin'), /Source is unavailable/);
    assert.equal(current.documents.files.length, 0);
    assert.equal(current.rendered(), 0);
  } finally { current.documents.dispose(); }
});

test('writable ZIP export captures the selected workspace after the picker and aborts a stale accepted sink', async () => {
  const current = fixture([{path: 'Program.cs', text: 'class Program {}'}]);
  const receipt = {aborted: 0, closed: 0, writes: 0};
  const sink = {
    write() { receipt.writes++; },
    close() { receipt.closed++; },
    abort(error) { receipt.aborted++; receipt.error = error; }
  };
  current.host.window.showSaveFilePicker = async () => {
    current.state.revision++;
    return {createWritable: async () => { current.state.revision++; return sink; }};
  };
  const ports = createStudioWorkspacePorts(current.host);
  try {
    await assert.rejects(ports.exportZip(), /Workspace changed during ZIP export/);
    assert.equal(receipt.aborted, 1);
    assert.equal(receipt.closed, 0);
    assert.match(receipt.error.message, /Workspace changed/);
    assert.deepEqual(current.messages, []);
    current.host.window.showSaveFilePicker = async () => { throw new DOMException('cancelled picker', 'AbortError'); };
    assert.equal(await ports.exportZip(), null);
    assert.equal(receipt.aborted, 1);
  } finally { current.documents.dispose(); }
});

test('blocked recovery keeps the original stored value and reports the blocking diagnostic', async () => {
  const current = fixture();
  const stored = '{not valid JSON';
  let saves = 0;
  current.host.storage = {getItem: () => stored, setItem: () => saves++};
  const ports = createStudioWorkspacePorts(current.host);
  try {
    assert.equal(await ports.recover(), true);
    assert.equal(saves, 0);
    assert.equal(current.host.storage.getItem('fixture'), stored);
    assert.equal(current.documents.files.length, 0);
    assert.match(current.messages[0][0], /Recovery was preserved/);
    assert.equal(current.messages[0][1], 'error');
  } finally { current.documents.dispose(); }
});

test('workspace entry actions preserve the provider and readonly wizard requests do not begin mutation', async () => {
  const current = fixture([{path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk" />'}]);
  const provider = {identity: 'original'};
  current.state.disk = {provider};
  current.host.projectWizard = {openProject() { assert.fail('readonly wizard must not open'); }};
  const ports = createStudioWorkspacePorts(current.host);
  try {
    const loaded = await ports.action('open-workspace-entry', {path: 'App.csproj', label: 'App'});
    assert.equal(loaded.options.disk, current.state.disk);
    assert.equal(loaded.options.entry, 'App.csproj');
    assert.equal(loaded.records, current.state.extraFiles);
    current.state.readOnly = true;
    await assert.rejects(ports.openProject(), /Stop debugging before creating files/);
    assert.equal(current.documents.files.length, 0);
  } finally { current.documents.dispose(); }
});
