import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../apps/studio/workbench/session-manager.js';
import { SessionBreakpoints } from '../apps/studio/workbench/session-breakpoints.js';
import { createWorkspaceState } from '../apps/studio/workbench/state.js';
import { createSourceBreakpointController } from '../apps/studio/debug-source-breakpoints.js';
import { decorateDebugEditors } from '../apps/studio/debug-editor-decorations.js';
import { fakeWorkers, fakeRuntime } from './a19-session-fixtures.js';

const source = { uri: 'assembly://Library/Shared.cs', originalUri: 'Shared.cs', text: 'class Shared {}',
  project: 'Library.csproj', contextId: 'library-net8', assemblyKey: 'Library, Version=1.0.0.0' };

test('verified source provenance follows each application and clears only the restarted owner', async () => {
  const workers = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: workers.factory });
  const first = sessions.create({ projectId: 'App.csproj' });
  const other = sessions.create({ projectId: 'Other.csproj' });
  const facade = createWorkspaceState({ debugSources: new Map(), debugSourceRecords: new Map(), debugSourceOriginals: new Map() },
    { sessions });
  try {
    await first.launch({ assembly: new Uint8Array([1]) });
    await other.launch({ assembly: new Uint8Array([2]) });
    workers.workers[0].emit({ event: 'loaded', sessionId: 1, sources: [source] });
    sessions.setActive(first.id);
    assert.equal(facade.state.debugSourceRecords.get(source.uri).contextId, source.contextId);
    sessions.setActive(other.id);
    assert.equal(facade.state.debugSourceRecords.has(source.uri), false);
    await other.restart();
    sessions.setActive(first.id);
    assert.equal(facade.state.debugSourceOriginals.get('Shared.cs').has(source.uri), true);
  } finally { facade.dispose(); sessions.dispose(); }
});

test('library breakpoint changes route to dependent apps by verified execution URI and reject mismatched source text', async () => {
  const workers = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: workers.factory });
  const app = sessions.create({ projectId: 'App.csproj' });
  const other = sessions.create({ projectId: 'Other.csproj' });
  const breakpoints = new SessionBreakpoints(sessions);
  try {
    await app.launch({ assembly: new Uint8Array([1]), dependencies: [{ assembly: new Uint8Array([2]), project: 'Library.csproj' }] });
    await other.launch({ assembly: new Uint8Array([3]) });
    workers.workers[0].emit({ event: 'loaded', sessionId: 1, sources: [source] });
    const count = workers.workers[1].requests.length;
    const result = await breakpoints.set('Library.csproj', 'Shared.cs', [{ line: 1 }], { sourceText: source.text });
    assert.equal(result.updated, 1);
    assert.equal(workers.workers[0].requests.at(-1).params.uri, source.uri);
    assert.equal(workers.workers[1].requests.length, count);
    assert.deepEqual(breakpoints.forProject('App.csproj', ['Library.csproj'])['Shared.cs'], [{ line: 1 }]);
    const before = workers.workers[0].requests.length;
    const mismatch = await breakpoints.set('Library.csproj', 'Shared.cs', [{ line: 2 }], { sourceText: 'changed source' });
    assert.equal(mismatch.updated, 0);
    assert.match(mismatch.failures[0].error.message, /no longer matches/);
    assert.equal(workers.workers[0].requests.length, before);
  } finally { breakpoints.dispose(); sessions.dispose(); }
});

test('source breakpoint controls delegate binding to the workbench owner even before an app is active', async () => {
  const calls = [];
  const state = { breakpoints: {}, debug: null, debugSettings: {} };
  const controller = createSourceBreakpointController({ state, sync: async uri => calls.push(uri),
    decorate() {}, render() {}, save() {}, onError: error => { throw error; } });
  await controller.toggle('Program.cs', 4);
  assert.deepEqual(calls, ['Program.cs']);
  assert.deepEqual(state.breakpoints['Program.cs'], [{ line: 4, enabled: true }]);
});

test('source decorations preserve diagnostics from all incoming workbench producers', () => {
  const diagnostic = { uri: 'Program.cs', code: 'PROJECT', message: 'project diagnostic' };
  const painted = [];
  const editor = { setDiagnostics: values => painted.push(values), setBreakpoints() {}, sourceSnapshot: () => ({}),
    setExecutionLocation() {}, setSelectedFrameLine() {} };
  decorateDebugEditors({ state: { debug: null, breakpoints: {}, debugSettings: {}, result: { diagnostics: [] } },
    editors: new Map([['Program.cs', editor]]), updateBanner() {}, diagnostics: () => [diagnostic] });
  assert.deepEqual(painted, [[diagnostic]]);
});
