import test from 'node:test';
import assert from 'node:assert/strict';
import { importStudioFiles } from '../apps/studio/workbench/studio-file-import.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { StudioExecution } from '../apps/studio/workbench/studio-execution.js';
import { StudioProjects } from '../apps/studio/workbench/studio-projects.js';
import { prepareStudioSourceFiles } from '../apps/studio/workbench/source-imports.js';
import { readStudioSource } from '../apps/studio/workbench/studio-source-reader.js';
import { studioDiskLimits, validateStudioSources } from '../apps/studio/workbench/workspace-limits.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';
import { sourcePolicyContext } from './support/studio-source-policy.js';
import { SlicedFile } from './fixtures/a20-source-file-fixture.js';

function fixture(t) {
  const current = studioLoaderFixture(t);
  const { context, state, services, calls } = current;
  // Share the exact project adapter used by the loader's snapshot closure, not a second set of build owners.
  const projects = context.projectServices;
  assert.ok(projects instanceof StudioProjects);
  const execution = new StudioExecution({ services, projects, state: () => state,
    ui: { status: value => calls.statuses.push(value), error: error => calls.errors.push(error), applyAnalysis() {} } });
  t.after(() => { execution.dispose(); projects.dispose(); });
  const withLoad = async (action, options = {}) => {
    const load = options.load ?? context.workspaceLoads.begin({ state, documents: services.documents, signal: options.signal });
    try { load.check(); return await action(load); }
    finally { if (!options.load) load.finish(); }
  };
  const imports = { state, withLoad,
    loadRecords: (records, options) => loadStudioWorkspace(records, options, context),
    workspaceSettings: () => ({ name: state.name, mode: state.workspaceMode, active: state.active, tabs: [...state.tabs] }),
    records: () => createStudioRecords({ state, documents: services.documents }) };
  return { ...current, projects, execution, imports };
}

function largeFile(bytes) {
  const prefix = '// LARGE_SOURCE_BEGIN\n';
  const suffix = '\n// LARGE_SOURCE_END\n';
  const chunk = new Blob([('// ' + 'x'.repeat(1020) + '\n').repeat(256)]);
  const body = bytes - prefix.length - suffix.length;
  const parts = [prefix, ...Array(Math.floor(body / chunk.size)).fill(chunk)];
  if (body % chunk.size) parts.push(chunk.slice(0, body % chunk.size));
  parts.push(suffix);
  return { file: new SlicedFile(parts, 'Large.cs'), prefix, suffix };
}

test('actual 200 MiB File import preserves siblings and refuses all compiler snapshots before text materialization', async t => {
  const current = fixture(t);
  const { services, state, projects, execution, calls, fake } = current;
  const previous = services.documents.models.get('Old.cs');
  const sibling = sourcePolicyContext(t, current, 'Old.cs');
  const pendingAnalysis = () => execution.analyze();
  const { file, prefix, suffix } = largeFile(200 * 1024 * 1024);
  assert.equal(file.size, 209_715_200);
  await importStudioFiles([file], {}, current.imports);
  const record = services.documents.require(file.name);
  const model = services.documents.models.get(file.name);
  const source = model.snapshot();
  assert.equal(services.documents.models.get('Old.cs'), previous);
  assert.equal(services.documents.list().length, 2);
  assert.equal(services.documents.active, file.name);
  assert.equal(record.byteLength, file.size);
  assert.equal(source.length, file.size);
  assert.equal(record.originalSource, source);
  assert.equal(record.source, source);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(source.getText(0, prefix.length), prefix);
  assert.equal(source.getText(source.length - suffix.length, source.length), suffix);
  assert.ok(file.reads.length > 800);
  assert.ok(file.reads.every(read => read.end - read.start <= 256 * 1024));
  assert.equal(await pendingAnalysis(), null);
  for (const method of ['documentSymbols', 'codeActions', 'rename', 'codeLens', 'hover', 'diagnostics']) {
    assert.equal(await sibling.context.safe(() => sibling.context.request(method, { offset: 0, newName: 'Changed' })), undefined);
    assert.match(sibling.context.statusElement.textContent, /STUDIO_COMPILER_SOURCE_LIMIT.*209715200 UTF-16 units/);
  }
  assert.equal((await sibling.context.request('readDocument', { targetUri: 'Old.cs' })).value.model, previous);
  assert.deepEqual((await sibling.context.request('projects')).value.map(project => project.id), ['$workspace']);
  assert.throws(() => projects.snapshot('$workspace'), { code: 'STUDIO_COMPILER_SOURCE_LIMIT' });
  await assert.rejects(projects.request('symbols', { uri: 'Old.cs' }), { code: 'STUDIO_COMPILER_SOURCE_LIMIT' });
  assert.equal(fake.workers.flatMap(worker => worker.requests).length, 0);
  assert.deepEqual(calls.errors, []);
  assert.deepEqual(sibling.errors, []);
  assert.ok(calls.statuses.some(status => status.includes('STUDIO_COMPILER_SOURCE_LIMIT')));
  assert.equal(state.active, file.name);
  model.applyEdits([{ start: 0, end: 2, text: '// edited' }]);
  assert.equal(model.getText(0, 9), '// edited');
  assert.equal(model.undo(), true);
  assert.equal(model.getText(0, prefix.length), prefix);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
});

test('cancelled real source import retains the previous document and never enters compilation', async t => {
  const current = fixture(t);
  const original = current.services.documents.models.get('Old.cs');
  const controller = new AbortController();
  controller.abort('Cancelled file selection');
  const file = new SlicedFile(['// cancelled'], 'Cancelled.cs');
  await assert.rejects(importStudioFiles([file], { signal: controller.signal }, current.imports), { name: 'AbortError' });
  assert.equal(file.reads.length, 0);
  assert.equal(current.services.documents.models.get('Old.cs'), original);
  assert.equal(current.services.documents.get('Cancelled.cs'), null);
  assert.equal(current.fake.workers.flatMap(worker => worker.requests).length, 0);
});

test('compiler eligibility never lifts Studio ingress budgets or explicit smaller reader bounds', async () => {
  assert.equal(studioDiskLimits.maxFileBytes, 256 * 1024 * 1024);
  assert.equal(studioDiskLimits.maxTotalBytes, 320 * 1024 * 1024);
  await assert.rejects(prepareStudioSourceFiles([{ name: 'Oversized.cs', size: studioDiskLimits.maxFileBytes + 1 }]), /256 MiB/);
  const record = length => ({ model: { publishedSnapshot: () => ({ length }) } });
  assert.throws(() => validateStudioSources([record(studioDiskLimits.maxFileBytes + 1)]), /editor buffer limit/);
  assert.throws(() => validateStudioSources([record(studioDiskLimits.maxFileBytes), record(64 * 1024 * 1024 + 1)]), /total source/);
  const file = new SlicedFile(['four'], 'Small.cs');
  await assert.rejects(readStudioSource(file, { limits: { maxFileBytes: 3 } }), /byte limit/);
  assert.equal(file.reads.length, 0);
  await assert.rejects(readStudioSource(file, { maxCharacters: 3 }), /character limit/);
});
