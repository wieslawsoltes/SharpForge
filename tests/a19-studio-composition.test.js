import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioExecution } from '../apps/studio/workbench/studio-execution.js';
import { StudioSave } from '../apps/studio/workbench/studio-save.js';
import { createStudioEditorFactory, remapBreakpointChanges } from '../apps/studio/workbench/studio-editor.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { studioDiskLimits, validateStudioSources } from '../apps/studio/workbench/workspace-limits.js';
import { parseLaunchFields } from '../apps/studio/workbench/launch-profile-dialog.js';
import { connectStudioStartupSelection } from '../apps/studio/workbench/studio-startup-selection.js';
import { studioComposition } from './support/studio-composition.js';
import { deferred } from './a19-session-fixtures.js';

test('startup toolbar selection changes the explicit compiler project while background work retains it', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { services, state } = fixture;
  const changed = [];
  t.after(connectStudioStartupSelection({ services, state: () => state, onChanged: id => changed.push(id) }));
  services.startup.select('Beta/Beta.csproj');
  assert.equal(state.startupProject, 'Beta/Beta.csproj');
  assert.equal(services.builds.activeId, 'Beta/Beta.csproj');
  await services.queue.run(['Alpha/Alpha.csproj'], { background: true });
  assert.equal(state.startupProject, 'Beta/Beta.csproj');
  assert.equal(services.builds.activeId, 'Beta/Beta.csproj');
  assert.deepEqual(changed, ['Beta/Beta.csproj']);
});

test('Studio routes language requests by document membership without selecting background projects', async t => {
  const fixture = studioComposition(message => ({ project: message.params.assemblyName }));
  t.after(fixture.dispose);
  const { projects, services, fake, state } = fixture;
  const alpha = 'Alpha/Alpha.csproj';
  const beta = 'Beta/Beta.csproj';
  assert.deepEqual(services.documents.projectsFor('Shared.cs'), [alpha, beta]);
  assert.deepEqual(await projects.request('hover', { uri: 'Beta/Program.cs' }), { project: 'Beta' });
  assert.equal(services.builds.activeId, alpha);
  assert.equal(state.startupProject, alpha);
  assert.equal(fake.workers[1].requests[0].params.files.some(file => file.uri === 'Alpha/Program.cs'), false);
  assert.equal(fake.workers[1].requests[0].params.projectId, beta);
  await projects.request('hover', { uri: 'Shared.cs', projectId: beta });
  // Prepared language results retain the actual worker owner for later navigation and lazy queries.
  assert.equal(fake.workers[1].requests[1].params.projectId, beta);
  assert.equal(services.builds.activeId, alpha);
  assert.equal(state.startupProject, alpha);
  state.active = 'Beta/Program.cs';
  assert.equal(projects.currentProjectId, beta);
  state.active = 'Shared.cs';
  assert.equal(projects.currentProjectId, alpha);
});

test('workspace replacement clears former project memberships, sessions and launch profiles', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { projects, services, state, fake } = fixture;
  services.profiles.set('Alpha/Alpha.csproj', { id: 'private', arguments: ['old'] });
  await services.launches.startNewInstance('Alpha/Alpha.csproj', { profile: 'private' });
  state.projectSystem = null;
  state.name = 'Replacement';
  state.startupProject = null;
  state.workspaceEpoch++;
  projects.sync();
  assert.deepEqual(services.documents.projectsFor('Shared.cs'), ['$workspace']);
  assert.deepEqual([...services.documents.projectMembership.keys()], ['$workspace']);
  assert.equal(services.sessions.list().length, 0);
  assert.equal(services.profiles.projects.has('Alpha/Alpha.csproj'), false);
  assert.deepEqual(services.startup.entries.map(entry => entry.projectId), ['$workspace']);
  assert.equal(fake.workers.slice(0, 3).every(worker => worker.terminated), true);
});

test('Studio language providers preserve originating versions and resolve the requested target document', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const calls = [];
  const integration = createStudioEditorFactory({
    services: fixture.services, state: () => fixture.state,
    requestCompiler: (...args) => { calls.push(args); return { remote: true }; }
  });
  t.after(() => integration.dispose());
  const signal = new AbortController().signal;
  const origin = { uri: 'Alpha/Program.cs', version: 1, signal };
  const target = await integration.language.invoke('readDocument', { ...origin, targetUri: 'Beta/Program.cs' });
  assert.equal(target.uri, 'Beta/Program.cs');
  assert.match(target.text, /beta/);
  assert.equal(calls.length, 0);
  await integration.language.invoke('readDocument', { ...origin, targetUri: 'External.cs' });
  assert.deepEqual(calls.pop(), ['readDocument', { uri: origin.uri, version: 1, targetUri: 'External.cs' }, { signal }]);
  for (const [local, remote] of [['documentSymbols', 'symbols'], ['folding', 'foldingRanges'], ['codeLens', 'referenceLenses'],
    ['resolveCodeAction', 'resolveCodeAction'], ['outlineReorder', 'outlineReorder']]) {
    await integration.language.invoke(local, origin);
    assert.deepEqual(calls.pop(), [remote, { uri: origin.uri, version: 1 }, { signal }]);
  }
  assert.deepEqual((await integration.language.invoke('projects', { uri: 'Beta/Program.cs' })).map(project => project.id),
    ['Beta/Beta.csproj']);
});

test('workspace record metadata does not read source text and explicit reads retain the captured snapshot', t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { services, state } = fixture;
  let sourceReads = 0;
  const record = services.documents.get('Alpha/Program.cs');
  const descriptor = Object.getOwnPropertyDescriptor(record, 'text');
  Object.defineProperty(record, 'text', { ...descriptor, get() { sourceReads++; return descriptor.get.call(this); } });
  const records = createStudioRecords({ state, documents: services.documents });
  const alpha = records.find(item => item.path === record.uri);
  assert.equal(alpha.length, record.text.length);
  sourceReads = 0;
  for (const item of records) { Object.keys(item); String(item.path); }
  assert.equal(sourceReads, 0);
  services.documents.update(record.uri, '// a later edit');
  assert.match(alpha.text, /alpha/);
  assert.equal(services.documents.get(record.uri).text, '// a later edit');
});

test('partial disk saves acknowledge only written snapshots and keep edits made during I/O dirty', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { services, state } = fixture;
  const alpha = 'Alpha/Program.cs';
  const beta = 'Beta/Program.cs';
  services.documents.update(alpha, '// first alpha');
  services.documents.update(beta, '// first beta');
  const pending = deferred();
  let changes;
  state.disk = { handles: new Map([[alpha, {}], [beta, {}]]), save: value => { changes = value; return pending.promise; } };
  let recoveries = 0;
  const save = new StudioSave({ documents: services.documents, state: () => state, nativeBuild: () => null,
    saveRecovery: () => { recoveries++; return true; }, notify() {}, refresh() {} });
  t.after(() => save.dispose());
  const operation = save.disk();
  services.documents.update(alpha, '// newer alpha');
  const error = Object.assign(new Error('second file failed'), { written: [alpha] });
  pending.reject(error);
  await assert.rejects(operation, /second file failed/);
  assert.deepEqual(changes.map(change => ({uri: change.uri, text: change.source.getText(0, change.source.length)})),
    [{ uri: alpha, text: '// first alpha' }, { uri: beta, text: '// first beta' }]);
  assert.equal(changes.some(change => Object.hasOwn(change, 'text')), false);
  assert.equal(services.documents.captureState(alpha).baseline, changes[0].source);
  assert.notEqual(services.documents.captureState(beta).baseline, changes[1].source);
  assert.equal(services.documents.get(alpha).dirty, true);
  assert.equal(services.documents.get(beta).dirty, true);
  services.documents.update(alpha, '// first alpha');
  // Matching text in a newer model revision does not inherit the captured revision's saved marker.
  assert.equal(services.documents.get(alpha).dirty, true);
  assert.equal(recoveries, 1);
  state.disk.save = async value => ({ written: value.map(change => change.uri) });
  await save.disk();
  assert.equal(services.documents.get(alpha).dirty, false);
  assert.equal(services.documents.get(beta).dirty, false);
  assert.equal(recoveries, 2);
});

test('start new instance keeps existing applications and launches the selected profile', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { services, projects, state } = fixture;
  const errors = [];
  const execution = new StudioExecution({ services, projects, state: () => state,
    ui: { error: value => errors.push(value), applyAnalysis() {}, setBusy() {}, setPanel() {}, stopped() {} } });
  services.profiles.set(projects.selectedId, { id: 'cli', arguments: ['literal $HOME'], environment: { APP: 'alpha' }, stopOnEntry: false });
  services.profiles.select(projects.selectedId, 'cli');
  const first = await execution.startNewInstance();
  const second = await execution.startNewInstance();
  assert.equal(errors.length, 0);
  assert.equal(services.sessions.list().length, 2);
  assert.notEqual(first.started[0], second.started[0]);
  for (const session of services.sessions.list()) {
    assert.deepEqual(session.lastLaunch.programArguments, ['literal $HOME']);
    assert.deepEqual(session.lastLaunch.environment, { APP: 'alpha' });
    assert.equal(session.lastLaunch.stopOnEntry, false);
    assert.equal(session.state, 'running');
  }
  await execution.stop({ all: true });
  assert.equal(services.sessions.list().every(session => !session.live), true);
});

test('silent Studio builds leave large documents available without sending them to the compiler', async t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const { services, projects, state, fake } = fixture;
  services.documents.update(state.active, 'x'.repeat(8 * 1024 * 1024 + 1));
  let status;
  const execution = new StudioExecution({ services, projects, state: () => state, ui: { status: value => { status = value; } } });
  assert.equal(await execution.build(true), null);
  assert.match(status, /automatic build disabled/);
  assert.equal(fake.workers.every(worker => worker.requests.length === 0), true);
});

test('Studio source policy admits 501 files and a 200 MiB buffer and rejects bounded overflow', () => {
  const many = Array.from({ length: 501 }, (_, index) => ({ uri: `File${index}.cs`, text: '// source' }));
  assert.equal(validateStudioSources(many), many);
  assert.equal(validateStudioSources([{ text: 'x'.repeat(200 * 1024 * 1024) }]).length, 1);
  assert.throws(() => validateStudioSources([{ text: 'x'.repeat(studioDiskLimits.maxFileBytes + 1) }]), /buffer limit/);
  assert.throws(() => validateStudioSources([{ text: 'x'.repeat(200 * 1024 * 1024) },
    { text: 'x'.repeat(121 * 1024 * 1024) }]), /total source/);
  assert.throws(() => validateStudioSources(Array(20_001).fill({ text: '' })), /20,000/);
  assert.throws(() => validateStudioSources([{ text: 42 }]), /contain text/);
});

test('launch fields preserve literal arguments and equals signs and reject invalid or duplicate environment entries', () => {
  const parsed = parseLaunchFields('["a b","$(literal)","","\\u03b1"]', 'APP=one=two\nEMPTY=\n');
  assert.deepEqual(parsed.arguments, ['a b', '$(literal)', '', 'α']);
  assert.deepEqual({ ...parsed.environment }, { APP: 'one=two', EMPTY: '' });
  for (const input of ['APP=one\nAPP=two', 'NO_EQUALS', '1APP=value']) assert.throws(() => parseLaunchFields('[]', input));
  assert.throws(() => parseLaunchFields('{"0":"bad"}', ''), /JSON array/);
  assert.throws(() => parseLaunchFields('[1]', ''), /JSON array/);
});

test('breakpoint remapping applies several ordered source changes against their captured versions', t => {
  const fixture = studioComposition();
  t.after(fixture.dispose);
  const model = fixture.services.documents.models.get(fixture.state.active);
  model.setValue('one\ntwo\nthree\nfour');
  let event;
  const dispose = model.onDidChange(value => { event = value; });
  t.after(dispose);
  model.applyEdits([{ start: 0, end: 0, text: 'zero\n' }, { start: 8, end: 14, text: '' }]);
  assert.deepEqual(remapBreakpointChanges([{ line: 2, column: 1 }, { line: 4, column: 1 }], event)
    .map(point => point.line), [3, 4]);
});
