import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {ProviderDiskWorkspace, encodeWorkspaceFile} from '@sharpforge/project-system';
import {validateStudioWorkspaceRecords} from '../apps/studio/workbench/workspace-limits.js';
import {studioWorkspaceFixture} from './support/a24-studio-workspace-fixture.js';
import {directoryFiles} from './support/workspace-application.js';

test('the service-backed session loads one active source from a 300-file lazy folder without opening the other models', async t => {
  const fixture = studioWorkspaceFixture(t);
  const records = Array.from({length: 300}, (_, index) => ({path: `C${index}.cs`, size: 10, lazy: true}));
  const reads = [];
  const disk = {records, folders: [], handles: new Map(), record: path => records.find(record => record.path === path),
    async load(path, options) {
      options.beforeAdmit();
      reads.push(path);
      return {path, text: 'class C {}', version: 1};
    }};
  await fixture.session.load(records, {disk, mode: 'folder', updateOnly: true});
  assert.deepEqual(reads, ['C0.cs']);
  assert.deepEqual([...fixture.documents.models.keys()], ['C0.cs']);
  assert.equal(fixture.host.context().records.length, 300);
  assert.equal(fixture.host.context().records.filter(record => record.lazy).length, 299);
  assert.equal(fixture.fake.workers.some(worker => worker.requests.length), false);
});

test('model-free recovery adopts immutable source and baseline identity without reading its text getter', async t => {
  const fixture = studioWorkspaceFixture(t);
  const model = new EditorModel('class C {}', {uri: 'Recovered.cs', version: 1});
  const baseline = model.snapshot();
  model.applyEdits([{start: 0, end: 0, text: '// recovered\n'}]);
  const source = model.snapshot();
  model.dispose();
  const record = {path: 'Recovered.cs', source, originalSource: baseline, version: source.version,
    bytes: encodeWorkspaceFile({path: 'Recovered.cs', text: 'class C {}'}), encoding: 'utf-8', byteLength: 10};
  Object.defineProperty(record, 'text', {enumerable: true, get: () => assert.fail('Recovery flattened a source')});
  const documentStates = new Map([['Recovered.cs', {uri: 'Recovered.cs', version: source.version,
    source, baseline, dirty: true, staleSave: false}]]);
  await fixture.session.load([record, {path: 'Unopened.cs', lazy: true, size: 42}], {
    mode: 'folder', readOnly: true, persist: false, updateOnly: true, dirty: ['Recovered.cs'], documentStates
  });
  assert.equal(fixture.documents.models.get('Recovered.cs').snapshot(), source);
  assert.equal(fixture.documents.baselines.get('Recovered.cs'), baseline);
  assert.equal(fixture.documents.require('Recovered.cs').dirty, true);
  assert.equal(fixture.documents.models.get('Recovered.cs').readOnly, true);
  assert.equal(fixture.state.recoveryReadOnly, true);
  assert.equal(source.statistics.textMaterialized, false);
  await fixture.session.load([{path: 'Granted.cs', text: 'class Granted {}'}], {mode: 'folder', updateOnly: true});
  assert.equal(fixture.state.recoveryReadOnly, false);
  assert.equal(fixture.state.readOnly, false);
  assert.equal(fixture.documents.models.get('Granted.cs').readOnly, false);
});

test('Explorer disk receipts preserve dirty sibling roots and adopt the explicit disk snapshot', async t => {
  const fixture = studioWorkspaceFixture(t);
  const {disk} = await directoryFiles([['A.cs', 'class A {}'], ['B.cs', 'class B {}']]);
  await fixture.session.load(disk.records, {disk, mode: 'folder', updateOnly: true});
  const sibling = fixture.documents.models.get('B.cs');
  const baseline = sibling.snapshot();
  sibling.applyEdits([{start: 0, end: 0, text: '// dirty\n'}]);
  const source = sibling.snapshot();
  fixture.state.membershipDirty = true;
  const replacement = new ProviderDiskWorkspace([...disk.records], disk.handles, disk.name, [], [], {provider: disk.provider});
  const captured = fixture.host.context();
  await fixture.session.commit({records: captured.records, documentStates: captured.documentStates,
    diskSnapshot: replacement, diskCommitted: true, persistedPaths: ['A.cs'], dirty: ['B.cs'], preserveMembership: true});
  assert.equal(fixture.state.disk, replacement);
  assert.equal(fixture.documents.models.get('B.cs'), sibling);
  assert.equal(sibling.snapshot(), source);
  assert.equal(fixture.documents.baselines.get('B.cs'), baseline);
  assert.deepEqual([...fixture.state.dirtyFiles], ['B.cs']);
  assert.equal(fixture.state.membershipDirty, true);
});

test('a disk replacement during lazy preflight cannot publish a record or replace current documents', async t => {
  const fixture = studioWorkspaceFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const original = fixture.documents.models.get('Old.cs');
  let published = false;
  const records = [{path: 'Pending.cs', size: 10, lazy: true}];
  const disk = {records, folders: [], handles: new Map(), async load(path, options) {
    entered.resolve();
    await release.promise;
    options.beforeAdmit();
    published = true;
    return {path, text: 'class C {}'};
  }};
  const pending = fixture.session.load(records, {disk, mode: 'folder', updateOnly: true});
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  await entered.promise;
  fixture.state.disk = {};
  release.resolve();
  await rejected;
  assert.equal(published, false);
  assert.equal(fixture.documents.models.get('Old.cs'), original);
});

test('post-adoption failures stay committed and never dispose the transferred source', async t => {
  const fixture = studioWorkspaceFixture(t);
  const model = new EditorModel('class Committed {}', {uri: 'Committed.cs', version: 1});
  const source = model.snapshot();
  const failure = new Error('Render subscriber failed');
  fixture.context.renderWorkspace = () => { throw failure; };
  await assert.rejects(fixture.session.load([{path: model.uri, model, source, version: model.version}], {
    mode: 'folder', updateOnly: true
  }), error => error === failure && error.committed === true);
  assert.equal(fixture.documents.models.get(model.uri), model);
  assert.doesNotThrow(() => model.prepareEdits([]));
  assert.equal(fixture.state.name, 'Workspace');
});

test('edited prepared source cannot reuse stale byte-length metadata or original byte storage', async () => {
  const model = new EditorModel('x', {uri: 'Budget.cs', version: 1});
  const originalSource = model.snapshot();
  model.applyEdits([{start: 1, end: 1, text: 'x'.repeat(31)}]);
  const source = model.snapshot();
  await assert.rejects(validateStudioWorkspaceRecords([{path: model.uri, source, originalSource,
    bytes: Uint8Array.of(120), byteLength: 1}], {limits: {maxFiles: 1, maxFileBytes: 16, maxTotalBytes: 16}}), RangeError);
  assert.equal(source.statistics.textMaterialized, false);
  model.dispose();
});
