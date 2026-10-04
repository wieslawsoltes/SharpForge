import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { Workspace } from '@sharpforge/workspace';
import { compilerSourceAvailability } from '../apps/studio/workbench/compiler-source-policy.js';
import { compilerSourceLimits } from '../apps/studio/workers/compiler-limits.js';
import { createCompilerWorkspace } from '../apps/studio/workers/compiler-workspace.js';
import { StudioExecution } from '../apps/studio/workbench/studio-execution.js';
import { studioComposition } from './support/studio-composition.js';
import { compilerPolicyTransport, sourcePolicyContext } from './support/studio-source-policy.js';

const ALPHA = 'Alpha/Alpha.csproj';
const BETA = 'Beta/Beta.csproj';
const maximum = compilerSourceLimits.maxDocumentLength;

test('Studio preflight and worker preserve default compiler bounds without reading lazy oversized text', () => {
  const workspace = new Workspace();
  const worker = createCompilerWorkspace({ maxDocumentLength: 300_000_000, maxDocuments: 20_000 });
  for (const current of [workspace, worker]) {
    assert.equal(current.maxDocumentLength, maximum);
    assert.equal(current.maxDocuments, compilerSourceLimits.maxDocuments);
    assert.throws(() => current.update('Large.cs', 'x'.repeat(maximum + 1)), /source size limit/);
    for (let index = 0; index < 100; index++) current.update(index + '.cs', '', 1);
    assert.throws(() => current.update('101.cs', '', 1), /Workspace document limit/);
  }
  let reads = 0;
  const record = { uri: 'Large.cs', length: maximum + 1,
    get text() { reads++; throw new Error('Eligibility must not read source text'); } };
  const denied = compilerSourceAvailability({}, [record], ALPHA);
  assert.equal(denied.available, false);
  assert.equal(denied.code, 'STUDIO_COMPILER_SOURCE_LIMIT');
  assert.equal(denied.projectId, ALPHA);
  assert.equal(denied.uri, record.uri);
  assert.match(denied.reason, /2000001 UTF-16 units/);
  assert.equal(reads, 0);
  record.length = maximum;
  assert.equal(compilerSourceAvailability({}, [record], ALPHA).available, true);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ uri: index + '.cs', length: maximum, text: '' }));
  assert.equal(compilerSourceAvailability({}, hundred, ALPHA).available, true);
  assert.equal(compilerSourceAvailability({}, [...hundred, record], ALPHA).code, 'STUDIO_COMPILER_DOCUMENT_LIMIT');
  assert.equal(compilerSourceAvailability({}, [{ uri: 'Unknown.cs' }], ALPHA).code, 'STUDIO_COMPILER_SOURCE_METADATA');
});

test('eligibility reads published preview roots and observes ordinary silent transactions immediately', t => {
  const model = new EditorModel('x'.repeat(maximum), { uri: 'Preview.cs' });
  t.after(() => model.dispose());
  const documents = { models: new Map([[model.uri, model]]) };
  const records = [{ uri: model.uri, get text() { throw new Error('No materialization'); } }];
  const original = model.snapshot();
  const lease = model.beginPreview();
  model.commitPrepared(model.prepareEdits([{ start: 0, end: 0, text: 'extra' }], { previewLease: lease }), { notify: false });
  assert.equal(compilerSourceAvailability(documents, records, ALPHA).available, true);
  assert.equal(original.statistics.textMaterialized, false);
  model.endPreview(lease);
  const prepared = model.prepareEdits([{ start: 0, end: 0, text: 'x' }]);
  model.commitPrepared(prepared, { notify: false });
  assert.equal(compilerSourceAvailability(documents, records, ALPHA).code, 'STUDIO_COMPILER_SOURCE_LIMIT');
  assert.equal(model.snapshot().statistics.textMaterialized, false);
});

function fixture(t) {
  const current = studioComposition(compilerPolicyTransport(t));
  t.after(() => { current.projects.dispose(); current.dispose(); });
  current.services.documents.models.get('Alpha/Program.cs').applyEdits([{ start: 0,
    end: current.services.documents.models.get('Alpha/Program.cs').length,
    text: 'class Alpha { static void Main(){int value=1;System.Console.WriteLine(value);} }' }]);
  const beta = current.services.documents.models.get('Beta/Program.cs');
  beta.applyEdits([{ start: 0, end: beta.length, text: '// ' + 'x'.repeat(maximum) }]);
  const statuses = [], errors = [];
  const execution = new StudioExecution({ ...current, state: () => current.state,
    ui: { status: message => statuses.push(message), error: error => errors.push(error), applyAnalysis() {} } });
  t.after(() => execution.dispose());
  return { ...current, beta, execution, statuses, errors };
}

test('an unrelated oversized project does not disable bounded project analysis or rename', async t => {
  const current = fixture(t);
  const { context } = sourcePolicyContext(t, current, 'Alpha/Program.cs');
  assert.equal(current.projects.sourceAvailability(ALPHA).available, true);
  assert.equal(current.projects.sourceAvailability(BETA).available, false);
  assert.ok((await context.request('documentSymbols')).value.length);
  const text = current.services.documents.require('Alpha/Program.cs').text;
  const renamed = await context.request('rename', { offset: text.indexOf('value'), newName: 'renamed' });
  assert.deepEqual(renamed.value.documentChanges.map(change => change.textDocument.uri), ['Alpha/Program.cs']);
  assert.equal(renamed.value.documentChanges[0].edits.length, 2);
  assert.equal((await current.execution.analyze()).success, true);
  assert.deepEqual(current.errors, []);
  assert.equal(current.services.builds.activeId, ALPHA);
  assert.equal(current.fake.workers.filter(worker => worker.options.name === 'compiler:' + BETA)
    .flatMap(worker => worker.requests).length, 0);
  assert.equal(current.beta.snapshot().statistics.textMaterialized, false);
});

test('shared/dependent rename and solution Fix All explicitly refuse a required oversized project', async t => {
  const current = fixture(t);
  const { integration } = sourcePolicyContext(t, current, 'Alpha/Program.cs');
  const shared = current.services.documents.require('Shared.cs');
  await assert.rejects(integration.language.invoke('rename', {
    uri: shared.uri, version: shared.version, offset: 6, newName: 'RenamedShared', projectId: ALPHA
  }), { code: 'STUDIO_COMPILER_SOURCE_LIMIT', projectId: BETA });
  await assert.rejects(integration.language.invoke('codeActions', {
    uri: 'Alpha/Program.cs', scope: 'solution', equivalenceKey: 'sharpforge.local.explicit-type'
  }), { code: 'STUDIO_COMPILER_SOURCE_LIMIT', projectId: BETA });
  assert.equal(current.beta.snapshot().statistics.textMaterialized, false);
});

test('a small linked view respects its explicit oversized project without disabling its other bounded owner', async t => {
  const current = fixture(t);
  const { context, errors } = sourcePolicyContext(t, current, 'Shared.cs');
  for (const method of ['codeActions', 'rename', 'documentSymbols']) {
    assert.equal(await context.request(method, { projectId: BETA, offset: 6, newName: 'Other' }), undefined);
    assert.match(context.statusElement.textContent, /STUDIO_COMPILER_SOURCE_LIMIT/);
  }
  assert.equal(current.fake.workers.flatMap(worker => worker.requests).length, 0);
  assert.equal((await context.request('documentSymbols', { projectId: ALPHA })).value[0].name, 'Shared');
  assert.deepEqual(errors, []);
  assert.equal(current.beta.snapshot().statistics.textMaterialized, false);
});

test('automatic work refuses the actual selected project and explicit requests retain the precise error', async t => {
  const current = fixture(t);
  current.state.startupProject = BETA;
  current.state.active = 'Beta/Program.cs';
  assert.equal(await current.execution.analyze(), null);
  assert.equal(await current.execution.build(true), null);
  assert.deepEqual(current.errors, []);
  assert.ok(current.statuses.every(status => status.includes('STUDIO_COMPILER_SOURCE_LIMIT')));
  assert.equal(await current.execution.build(false), null);
  assert.equal(current.errors[0].code, 'STUDIO_COMPILER_SOURCE_LIMIT');
  await assert.rejects(current.projects.request('symbols', { uri: current.state.active }), { code: 'STUDIO_COMPILER_SOURCE_LIMIT' });
  assert.throws(() => current.services.builds.get(BETA).snapshot(), { code: 'STUDIO_COMPILER_SOURCE_LIMIT' });
  assert.equal(current.fake.workers.flatMap(worker => worker.requests).length, 0);
  const beta = current.beta;
  beta.applyEdits([{ start: 0, end: beta.length, text: 'class Beta { static void Main(){} }' }]);
  assert.equal(current.projects.sourceAvailability(BETA).available, true);
  assert.equal((await current.execution.analyze()).success, true);
});
