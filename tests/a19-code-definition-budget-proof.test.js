import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDefinitionProof} from './editor-budget-trace.mjs';

// Synthetic proof fixtures reproduce the a5 source-document/workspace distinction; these are not browser timing evidence.
function proof() {
  const records = [{path: 'Budget.csproj', text: '<Project Sdk="Microsoft.NET.Sdk" />'},
    {path: 'Alpha.cs', text: 'class Alpha { void RunAlpha() {} }'},
    {path: 'Beta.cs', text: 'class Beta { void RunBeta() {} }'},
    {path: 'Calls.cs', text: ' class Calls { void Main() { Alpha.RunAlpha(); Beta.RunBeta(); } }'}];
  const targets = [{id: 'source-alpha', kind: 'source', uri: 'Alpha.cs', text: records[1].text, name: 'RunAlpha', offset: 36},
    {id: 'source-beta', kind: 'source', uri: 'Beta.cs', text: records[2].text, name: 'RunBeta', offset: 53},
    {id: 'framework-metadata', kind: 'metadata', offset: 60}];
  const fixture = {records, callerUri: 'Calls.cs', neutralOffset: 0, targets};
  const observation = {phase: 'boundary', durationMs: 155, observedDomMs: 140, correct: true, focusPreserved: true,
    focusEvents: [], sourceVersion: 1, readOnly: true, visible: true};
  const definition = {samples: [{sourceVersion: 1}],
    setup: {uri: 'Calls.cs', projectId: 'Budget.csproj', sourceVersion: 1, readOnly: true, visible: true,
      workspace: {version: 1, records: records.map(record => ({...record})), projectIds: ['Budget.csproj'],
        sourceDocuments: records.slice(1).map(record => ({uri: record.path, text: record.text,
          version: 1, projectIds: ['Budget.csproj']}))}},
    boundaries: {neutralClears: true, rapidCaretUsesLatest: true, observations: [
      {...observation, case: 'none', index: 0, offset: 0,
        title: 'No source or referenced metadata definition at the caret', text: '', selection: ''},
      {...observation, focusEvents: [], case: 'source-beta', index: 1, offset: targets[1].offset,
        title: 'Beta.cs', text: targets[1].text, selection: 'RunBeta'}
    ]}};
  return {fixture, definition};
}

test('the actual fixture requires three source documents plus its separately loaded project record', () => {
  const {fixture, definition} = proof();
  assert.equal(definition.setup.workspace.sourceDocuments.length, 3);
  assert.equal(definition.setup.workspace.records.length, 4);
  assert.doesNotThrow(() => validateDefinitionProof(definition, fixture));
});

test('a legacy count, including a5 count three, cannot replace actual workspace proof', () => {
  for (const workspaceRecords of [3, 4]) {
    const {fixture, definition} = proof();
    delete definition.setup.workspace;
    definition.setup.workspaceRecords = workspaceRecords;
    assert.throws(() => validateDefinitionProof(definition, fixture), /actual workspace setup/u);
  }
});

for (const [name, mutate, message] of [
  ['missing project XML', value => { value.setup.workspace.records.shift(); }, /workspace source\/project records/u],
  ['wrong project XML', value => { value.setup.workspace.records[0].text = '<Project />'; }, /workspace source\/project records/u],
  ['unrelated workspace record', value => { value.setup.workspace.records[0].path = 'Unrelated.csproj'; }, /workspace source\/project records/u],
  ['project counted as a source', value => {
    value.setup.workspace.sourceDocuments.push({uri: 'Budget.csproj', text: '<Project />', version: 1, projectIds: ['Budget.csproj']});
  }, /source-document count/u],
  ['missing source', value => { value.setup.workspace.sourceDocuments.pop(); }, /source-document count/u],
  ['duplicate source', value => { value.setup.workspace.sourceDocuments[1] = value.setup.workspace.sourceDocuments[0]; }, /source document/u],
  ['wrong source contents', value => { value.setup.workspace.sourceDocuments[0].text = 'class Wrong {}'; }, /source document contents/u],
  ['unregistered project', value => { value.setup.workspace.projectIds = []; }, /project ownership/u],
  ['wrong selected project', value => { value.setup.projectId = 'Other.csproj'; }, /project ownership/u],
  ['wrong source owner', value => { value.setup.workspace.sourceDocuments[0].projectIds = ['Other.csproj']; }, /project ownership/u],
  ['stale caller snapshot', value => { value.setup.workspace.sourceDocuments[2].version = 2; }, /Caller source version/u],
  ['changed sample revision', value => { value.samples[0].sourceVersion = 2; }, /source version changed/u],
  ['editable setup', value => { value.setup.readOnly = false; }, /actual workspace setup/u],
  ['flags without raw boundaries', value => { delete value.boundaries.observations; }, /boundary observations/u],
  ['uncleared neutral source', value => { value.boundaries.observations[0].text = 'class Old {}'; }, /Neutral caret/u],
  ['uncleared neutral selection', value => { value.boundaries.observations[0].selection = 'Old'; }, /Neutral caret/u],
  ['wrong latest target', value => { value.boundaries.observations[1].text = 'class Alpha {}'; }, /exact source target/u],
  ['wrong latest caret', value => { value.boundaries.observations[1].offset--; }, /focus, version or DOM/u],
  ['boundary focus transfer', value => { value.boundaries.observations[1].focusEvents.push({tag: 'TEXTAREA'}); }, /focus, version or DOM/u],
  ['stale boundary revision', value => { value.boundaries.observations[1].sourceVersion = 2; }, /source version changed/u],
  ['duplicated boundary index', value => { value.boundaries.observations[1].index = 0; }, /boundary identity/u],
  ['failed boundary observation', value => { value.boundaries.observations[1].correct = false; }, /boundary identity/u],
  ['impossible boundary timing', value => { value.boundaries.observations[1].observedDomMs = 156; }, /focus, version or DOM/u]
]) test('rejects ' + name + ' even when both boundary summary flags are true', () => {
  const {fixture, definition} = proof();
  mutate(definition);
  assert.throws(() => validateDefinitionProof(definition, fixture), message);
});
