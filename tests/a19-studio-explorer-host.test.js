import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplorerCommands } from '../apps/studio/explorer-commands.js';
import { readStudioFiles } from '../apps/studio/workbench/source-imports.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { commitStudioExplorerWorkspace } from '../apps/studio/workbench/studio-explorer-workspace.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';

const projectPath = 'App.csproj';
const projectXml = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Library</OutputType><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup>
  <ItemGroup><Compile Include="A.cs" /><Compile Include="B.cs" /></ItemGroup>
</Project>`;

async function explorerFixture(t) {
  const fixture = studioLoaderFixture(t);
  const { services, state, context } = fixture;
  const documents = services.documents;
  const records = await readStudioFiles([
    new File([projectXml], projectPath),
    new File(['class A {}\n'], 'A.cs'),
    new File(['class B {}\n'], 'B.cs')
  ]);
  await loadStudioWorkspace(records, { name: 'Explorer host', entry: projectPath, mode: 'project', updateOnly: true }, context);
  documents.open('B.cs');
  documents.open('A.cs');
  state.breakpoints = { 'A.cs': [{ line: 1 }] };
  context.workspaceSettings = () => ({
    ...context.sessionRecovery.export(), name: state.name, mode: state.workspaceMode,
    entry: state.projectSystem?.solution?.path, startup: state.startupProject,
    configuration: state.configuration, langVersion: state.langVersion,
    active: state.active, tabs: state.tabs, breakpoints: state.breakpoints, functionBreakpoints: state.functionBreakpoints
  });
  const commits = [];
  const host = {
    context: () => ({
      identity: 'preview:' + state.workspaceEpoch, native: state.nativeMode, readOnly: state.readOnly,
      records: createStudioRecords({ state, documents }), folders: state.folders, name: state.name,
      active: state.active, tabs: state.tabs, breakpoints: state.breakpoints, dirty: [...documents.dirtyFiles],
      solutionPath: state.projectSystem?.solution?.path, startup: state.startupProject, snapshot: state.projectSnapshot
    }),
    ownsModel: model => documents.ownsModel(model),
    captureDocumentState: uri => documents.get(uri) ? documents.captureState(uri) : null,
    commit: payload => {
      commits.push(payload);
      return commitStudioExplorerWorkspace(payload, context);
    },
    render() {}, notice() {}, error(error) { throw error; }
  };
  const commands = new ExplorerCommands(host);
  t.after(() => commands.dispose());
  return { ...fixture, documents, commands, commits, host };
}

const compilePaths = state => state.projectSystem.projects.get(projectPath).compile.map(file => file.path).sort();

test('an Explorer host commit retains unchanged models and their saved baselines, including unsaved siblings', async t => {
  const { documents, state, commands, calls } = await explorerFixture(t);
  const clean = documents.models.get('A.cs');
  const dirty = documents.models.get('B.cs');
  dirty.applyEdits([{ start: 0, end: 0, text: '// unsaved sibling\n' }]);
  const cleanSource = clean.snapshot();
  const dirtySource = dirty.snapshot();
  const cleanBaseline = documents.baselines.get('A.cs');
  const dirtyBaseline = documents.baselines.get('B.cs');
  const epoch = state.workspaceEpoch;
  const stopped = calls.stopped;

  await commands.perform([{ kind: 'create', path: 'C.cs', text: 'class C {}\n' }]);

  assert.equal(documents.models.get('A.cs'), clean);
  assert.equal(documents.models.get('B.cs'), dirty);
  assert.equal(clean.snapshot(), cleanSource);
  assert.equal(dirty.snapshot(), dirtySource);
  assert.equal(documents.baselines.get('A.cs'), cleanBaseline);
  assert.equal(documents.baselines.get('B.cs'), dirtyBaseline);
  assert.equal(documents.require('A.cs').dirty, false);
  assert.equal(documents.require('B.cs').dirty, true);
  assert.equal(dirty.isDirty, true);
  assert.equal(documents.require('C.cs').dirty, true);
  assert.equal(documents.baselines.get('C.cs'), null);
  assert.equal(state.workspaceEpoch, epoch);
  assert.equal(calls.stopped, stopped);
  assert.equal(state.membershipDirty, true);
  assert.equal(cleanSource.statistics.textMaterialized, false);
  assert.equal(dirtySource.statistics.textMaterialized, false);
});

test('dirty Explorer rename and undo preserve source roots, baseline history, active tabs and breakpoints', async t => {
  const { documents, state, commands } = await explorerFixture(t);
  const original = documents.models.get('A.cs');
  const sibling = documents.models.get('B.cs');
  original.applyEdits([{ start: 0, end: 0, text: '// unsaved\n' }]);
  const editedSource = original.snapshot();
  const originalBaseline = documents.baselines.get('A.cs');

  await commands.move([{ from: 'A.cs', to: 'Renamed.cs' }], false);
  assert.equal(documents.get('A.cs'), null);
  assert.equal(documents.require('Renamed.cs').dirty, true);
  assert.equal(documents.models.get('Renamed.cs').getText(0, 10), '// unsaved');
  assert.equal(documents.baselines.get('Renamed.cs').getText(0, 7), 'class A');
  assert.equal(documents.baselines.get('Renamed.cs').uri, 'Renamed.cs');
  assert.equal(documents.models.get('B.cs'), sibling);
  assert.equal(state.active, 'Renamed.cs');
  assert.deepEqual(new Set(state.tabs), new Set(['Renamed.cs', 'B.cs']));
  assert.deepEqual(Object.entries(state.breakpoints), [['Renamed.cs', [{ line: 1 }]]]);
  assert.deepEqual(compilePaths(state), ['B.cs', 'Renamed.cs']);
  assert.equal(commands.history.length, 1);
  assert.throws(() => original.prepareEdits([]), /disposed/);

  await commands.undo();
  assert.equal(documents.get('Renamed.cs'), null);
  assert.equal(documents.models.get('A.cs').snapshot(), editedSource);
  assert.equal(documents.require('A.cs').dirty, true);
  assert.equal(documents.dirtyFiles.has('A.cs'), true);
  assert.equal(documents.baselines.get('A.cs'), originalBaseline);
  assert.equal(documents.models.get('B.cs'), sibling);
  assert.equal(state.active, 'A.cs');
  assert.deepEqual(new Set(state.tabs), new Set(['A.cs', 'B.cs']));
  assert.deepEqual(Object.entries(state.breakpoints), [['A.cs', [{ line: 1 }]]]);
  assert.equal(state.projectSystem.files.get(projectPath).text, projectXml);
  assert.deepEqual(compilePaths(state), ['A.cs', 'B.cs']);
  assert.equal(commands.history.length, 0);
  assert.equal(editedSource.statistics.textMaterialized, false);
  assert.equal(originalBaseline.statistics.textMaterialized, false);
});

test('document reset subscribers observe the same project XML, membership and active source as the Explorer commit', async t => {
  const { documents, state, commands } = await explorerFixture(t);
  const observations = [];
  const unsubscribe = documents.subscribe(event => {
    if (event.type !== 'reset') return;
    observations.push({
      documents: [...documents.models.keys()].sort(), compile: compilePaths(state), active: state.active,
      extraXml: state.extraFiles.find(record => record.path === projectPath).text,
      projectXml: state.projectSystem.files.get(projectPath).text,
      snapshot: state.projectSnapshot, membershipDirty: state.membershipDirty
    });
  });
  t.after(unsubscribe);

  await commands.move([{ from: 'A.cs', to: 'Source/Renamed.cs' }], false);

  assert.equal(observations.length, 1);
  const observed = observations[0];
  assert.deepEqual(observed.documents, ['B.cs', 'Source/Renamed.cs']);
  assert.deepEqual(observed.compile, observed.documents);
  assert.equal(observed.active, 'Source/Renamed.cs');
  assert.equal(observed.extraXml, observed.projectXml);
  assert.match(observed.projectXml, /Compile Include="Source\/Renamed\.cs"/);
  assert.doesNotMatch(observed.projectXml, /Compile Include="A\.cs"/);
  assert.equal(observed.snapshot, state.projectSnapshot);
  assert.equal(observed.membershipDirty, true);
});

test('Explorer opening guard preserves edits made during asynchronous workspace preflight', async t => {
  const { documents, state, commands, commits, calls } = await explorerFixture(t);
  const original = documents.models.get('A.cs');
  const before = original.snapshot();
  const baseline = documents.baselines.get('A.cs');
  const projectSystem = state.projectSystem;
  const projectSnapshot = state.projectSnapshot;
  const rendered = calls.rendered;
  let validations = 0;
  const validate = () => {
    validations++;
    if (documents.models.get('A.cs') !== original || original.snapshot() !== before) {
      throw new Error('Source changed while the Explorer workspace was preparing');
    }
  };

  const pending = commands.perform([{ kind: 'move', path: 'A.cs', destination: 'Stale.cs' }],
    [{ from: 'A.cs', to: 'Stale.cs' }], { validate });
  assert.equal(validations, 1);
  const stagedModel = commits[0].records.find(record => record.path === 'Stale.cs').model;
  const arrived = '// arrived during preflight\n';
  original.applyEdits([{ start: 0, end: 0, text: arrived }]);
  await assert.rejects(pending, { name: 'AbortError', message: 'Documents changed during workspace opening' });

  assert.equal(validations, 1, 'The opening guard rejects before the Explorer commit validator runs again');
  assert.equal(documents.models.get('A.cs'), original);
  assert.equal(documents.get('Stale.cs'), null);
  assert.equal(documents.require('A.cs').dirty, true);
  assert.equal(original.getText(0, arrived.length), arrived);
  assert.equal(documents.baselines.get('A.cs'), baseline);
  assert.equal(state.projectSystem, projectSystem);
  assert.equal(state.projectSnapshot, projectSnapshot);
  assert.equal(state.projectSystem.files.get(projectPath).text, projectXml);
  assert.equal(state.active, 'A.cs');
  assert.equal(commands.history.length, 0);
  assert.equal(calls.rendered, rendered);
  assert.throws(() => stagedModel.prepareEdits([]), /disposed/);
  assert.doesNotThrow(() => original.prepareEdits([]));
});

test('Explorer host rejects a superseding workspace revision before adopting its staged source models', async t => {
  const { documents, state, commands, commits } = await explorerFixture(t);
  const original = documents.models.get('A.cs');
  const baseline = documents.baselines.get('A.cs');
  const projectSystem = state.projectSystem;
  const previousTabs = [...state.tabs];
  const pending = commands.perform([{ kind: 'copy', path: 'A.cs', destination: 'Obsolete.cs' }]);
  const stagedModel = commits[0].records.find(record => record.path === 'Obsolete.cs').model;
  state.revision++;
  const supersedingRevision = state.revision;
  await assert.rejects(pending, { name: 'AbortError', message: 'Documents changed during workspace opening' });

  assert.equal(state.revision, supersedingRevision);
  assert.equal(state.projectSystem, projectSystem);
  assert.equal(documents.models.get('A.cs'), original);
  assert.equal(documents.baselines.get('A.cs'), baseline);
  assert.equal(documents.get('Obsolete.cs'), null);
  assert.deepEqual(state.tabs, previousTabs);
  assert.equal(state.membershipDirty, false);
  assert.equal(commands.history.length, 0);
  assert.throws(() => stagedModel.prepareEdits([]), /disposed/);
});
