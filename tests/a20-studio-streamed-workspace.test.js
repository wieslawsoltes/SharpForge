import test from 'node:test';
import assert from 'node:assert/strict';
import { readStudioFiles, prepareStudioSourceFiles } from '../apps/studio/workbench/source-imports.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { storeStudioRecovery, canRecoverStudioWorkspace } from '../apps/studio/workbench/studio-recovery-store.js';
import { StudioSave } from '../apps/studio/workbench/studio-save.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';

function prohibitText(record) {
  Object.defineProperty(record, 'text', { configurable: true, enumerable: true,
    get() { throw new Error('The workspace loader must not materialize prepared text'); } });
  return record;
}

test('200 MiB File reaches the actual Studio workspace model through chunked ingress with automatic work bounded', async t => {
  const { context, services, calls, fake } = studioLoaderFixture(t);
  const chunk = new Uint8Array(256 * 1024).fill(120);
  const file = new File(Array(800).fill(chunk), 'Large.cs');
  file.text = () => { throw new Error('Whole-file text read is forbidden'); };
  file.arrayBuffer = () => { throw new Error('Whole-file byte read is forbidden'); };
  const records = await readStudioFiles([file]);
  const prepared = prohibitText(records[0]);
  const source = prepared.source;
  let captures = 0;
  context.saveLocal = () => storeStudioRecovery({ documents: services.documents, extraFiles: [],
    storage: { setItem() { throw new Error('Large recovery must not serialize'); } }, key: 'workspace',
    capture: () => { captures++; return {}; } });
  const result = await loadStudioWorkspace(records, { mode: 'folder', name: 'Large source' }, context);
  assert.equal(result.solution.name, 'Large source');
  assert.equal(services.documents.models.get('Large.cs'), prepared.model);
  assert.equal(source.length, 209_715_200);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(captures, 0);
  assert.equal(canRecoverStudioWorkspace(services.documents), false);
  assert(calls.statuses.includes('Large file mode — automatic build disabled'));
  assert.equal(fake.workers.flatMap(worker => worker.requests).length, 0);
  assert.deepEqual(calls.errors, []);
  prepared.model.applyEdits([{ start: 209_715_199, end: 209_715_200, text: 'y' }]);
  assert.equal(prepared.model.getText(209_715_198, 209_715_200), 'xy');
  assert.equal(prepared.model.undo(), true);
  assert.equal(source.statistics.textMaterialized, false);
});

test('rejected settings and cancelled selection release new prepared models without changing the current workspace', async t => {
  const { context, services, state, calls } = studioLoaderFixture(t);
  const old = services.documents.models.get('Old.cs');
  old.applyEdits([{ start: 0, end: 0, text: '// unsaved\n' }]);
  const records = await readStudioFiles([new File(['// new'], 'New.cs')]);
  await assert.rejects(loadStudioWorkspace(records, { settings: { langVersion: '99' } }, context), /language version/);
  assert.equal(services.documents.models.get('Old.cs'), old);
  assert.equal(state.name, 'Old workspace');
  assert.equal(old.isDirty, true);
  assert.throws(() => records[0].model.prepareEdits([]), /disposed/i);
  assert.equal(calls.stopped, 0);
  const cancelled = await readStudioFiles([new File(['// another'], 'Other.cs')]);
  context.projectWizard.selectImport = async () => null;
  assert.equal(await loadStudioWorkspace(cancelled, { select: true }, context), null);
  assert.throws(() => cancelled[0].model.prepareEdits([]), /disposed/i);
  assert.doesNotThrow(() => old.prepareEdits([]));
});

test('adding prepared files retains current projects, dirty models and private launch settings', async t => {
  const { context, services, state, calls } = studioLoaderFixture(t);
  const old = services.documents.models.get('Old.cs');
  old.applyEdits([{ start: 0, end: 0, text: '// unsaved\n' }]);
  const baseline = services.documents.baselines.get('Old.cs');
  services.profiles.set('$workspace', { id: 'private', arguments: ['keep this literal'] });
  const current = createStudioRecords({ state, documents: services.documents });
  const prepared = await prepareStudioSourceFiles([new File(['// addition'], 'Added.cs')], current);
  await loadStudioWorkspace(prepared.records, { name: state.name, mode: 'folder', preserveDocumentState: true }, context);
  assert.equal(services.documents.models.get('Old.cs'), old);
  assert.equal(services.documents.baselines.get('Old.cs'), baseline);
  assert.equal(services.documents.require('Old.cs').dirty, true);
  assert.equal(old.isDirty, true);
  assert.deepEqual(services.profiles.get('$workspace', 'private').arguments, ['keep this literal']);
  assert.equal(calls.stopped, 0);
  assert.equal(state.workspaceEpoch, 1);
  assert.equal(services.documents.require('Added.cs').dirty, false);
});

test('committed document callback errors still install matching project metadata and retain adopted models', async t => {
  const { context, services, state } = studioLoaderFixture(t);
  const off = services.documents.subscribe(event => { if (event.type === 'reset') throw new Error('view refresh failed'); });
  t.after(off);
  const records = await readStudioFiles([new File(['// new'], 'New.cs')]);
  await assert.rejects(loadStudioWorkspace(records, { name: 'Committed workspace', mode: 'folder' }, context),
    error => error.code === 'DOCUMENT_COMMITTED' && error.committed === true);
  assert.equal(state.name, 'Committed workspace');
  assert.equal(services.documents.models.get('New.cs'), records[0].model);
  assert.doesNotThrow(() => records[0].model.prepareEdits([]));
});

test('bulk Studio save passes captured roots and preserves newer edits after partial disk completion', async t => {
  const { services, state } = studioLoaderFixture(t);
  const old = services.documents.models.get('Old.cs');
  old.applyEdits([{ start: 0, end: 0, text: '// save\n' }]);
  const source = old.snapshot();
  let payload;
  state.disk = { handles: new Map([['Old.cs', {}]]), save: async changes => {
    payload = changes;
    old.applyEdits([{ start: 0, end: 0, text: '// later\n' }]);
    throw Object.assign(new Error('A later file failed'), { written: ['Old.cs'] });
  } };
  const saves = new StudioSave({ documents: services.documents, state: () => state,
    saveRecovery: () => false, notify() {}, refresh() {} });
  t.after(() => saves.dispose());
  await assert.rejects(saves.disk(), /later file/);
  assert.equal(payload[0].source, source);
  assert.equal(Object.hasOwn(payload[0], 'text'), false);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(services.documents.baselines.get('Old.cs'), source);
  assert.equal(services.documents.require('Old.cs').dirty, true);
});

test('Save As download outcome retains dirty state and a replaced workspace cannot receive a late saved marker', async t => {
  const { services, state } = studioLoaderFixture(t);
  services.documents.models.get('Old.cs').applyEdits([{ start: 0, end: 0, text: 'dirty ' }]);
  const saves = new StudioSave({ documents: services.documents, state: () => state, saveRecovery: () => false,
    saveAs: async () => ({ ok: false, exported: true }), notify() {}, refresh() {} });
  t.after(() => saves.dispose());
  const exported = await saves.as('Old.cs');
  assert.equal(exported.exported, true);
  assert.equal(services.documents.require('Old.cs').dirty, true);
  saves.saveAs = async () => {
    services.documents.replace([{ uri: 'Old.cs', text: '// replacement', version: 1 }], { discard: true });
    services.documents.update('Old.cs', '// replacement newer');
    return { ok: true };
  };
  await saves.as('Old.cs');
  assert.equal(services.documents.get('Old.cs').text, '// replacement newer');
  assert.equal(services.documents.get('Old.cs').dirty, true);
  assert.equal(services.documents.baselines.get('Old.cs').text, '// replacement');
});
