import test from 'node:test';
import assert from 'node:assert/strict';
import {setDebugSources, workspaceFileForDebugSource, debugSourceForWorkspace,
  workspaceDebugPoint, navigateDebugSource} from '../apps/studio/debug-sources.js';
import {debugBreakpointRows} from '../apps/studio/debug-breakpoint-rows.js';
import {runtimeSourceRecords} from '../apps/studio/workers/runtime-sources.js';

function setup(files, sources) {
  const state = {files, debug: {state: 'paused', frames: [], profile: 'source'}, breakpoints: {}, functionBreakpoints: []};
  setDebugSources(state, sources);
  return state;
}

const source = (assemblyKey, text, extras = {}) => ({uri: 'sharpforge-assembly://' + assemblyKey + '/Shared.cs',
  originalUri: 'Shared.cs', assemblyKey, text, ...extras});

test('debug navigation opens an exact current original source and preserves executable identity for painting', () => {
  const loaded = source('Library', 'current');
  const file = {uri: 'Shared.cs', text: 'current'};
  const state = setup([file], [loaded]);
  const point = {uri: loaded.uri, line: 3, column: 5, assemblyKey: 'Library'};
  state.debug.point = point;
  assert.equal(workspaceFileForDebugSource(state, loaded.uri), file);
  assert.equal(debugSourceForWorkspace(state, file.uri).uri, loaded.uri);
  assert.deepEqual(workspaceDebugPoint(state, point, file.uri), {...point, uri: file.uri, executionUri: loaded.uri});
  assert.equal(point.uri, loaded.uri);
  const calls = [];
  const result = navigateDebugSource({state, openFile: uri => calls.push(['open', uri]),
    getEditor: () => ({gotoLine: (...position) => calls.push(['position', ...position])})}, point);
  assert.deepEqual(calls, [['open', 'Shared.cs'], ['position', 3, 5]]);
  assert.deepEqual(result, {kind: 'workspace', uri: 'Shared.cs', executionUri: loaded.uri});
});

test('changed or unavailable source uses the read-only viewer with the exact executing document key', () => {
  const loaded = source('Library', 'compiled');
  const state = setup([{uri: 'Shared.cs', text: 'edited'}], [loaded]);
  const shown = [];
  const point = {source: loaded.uri, line: 7, column: 2};
  const result = navigateDebugSource({state, openFile: () => assert.fail('Edited workspace text is not the executing source'),
    getEditor: () => assert.fail('No workspace editor is selected'), showSymbolSource: point => shown.push(point)}, point);
  assert.equal(result.kind, 'embedded');
  assert.equal(shown[0].uri, loaded.uri);
  assert.equal(shown[0].line, 7);
  assert.equal(workspaceDebugPoint(state, {uri: loaded.uri}, 'Shared.cs'), null);
});

test('ambiguous generated paths never select a workspace buffer without matching project context', () => {
  const left = source('Left', 'same', {generated: true, contextId: 'left'});
  const right = source('Right', 'same', {generated: true, contextId: 'right'});
  const file = {uri: 'Shared.cs', text: 'same', generated: true};
  const state = setup([file], [left, right]);
  assert.equal(workspaceFileForDebugSource(state, left.uri), null);
  assert.equal(debugSourceForWorkspace(state, 'Shared.cs'), null);
  file.contextId = 'left';
  assert.equal(workspaceFileForDebugSource(state, left.uri), file);
  assert.equal(workspaceFileForDebugSource(state, right.uri), null);
  assert.equal(debugSourceForWorkspace(state, 'Shared.cs').uri, left.uri);
});

test('same execution URI shared by identical generated sources requires the point assembly identity', () => {
  const sources = [source('Left', 'same'), source('Right', 'same')].map(item => ({...item, uri: 'Shared.cs', generated: true}));
  const file = {uri: 'Shared.cs', text: 'same', generated: true, assemblyKey: 'Left'};
  const state = setup([file], sources);
  assert.equal(workspaceFileForDebugSource(state, 'Shared.cs'), null);
  assert.equal(workspaceFileForDebugSource(state, 'Shared.cs', {assemblyKey: 'Left'}), file);
  assert.equal(workspaceFileForDebugSource(state, 'Shared.cs', {assemblyKey: 'Right'}), null);
});

test('frame navigation, source breakpoint bindings and current-source choice use the selected context', () => {
  const left = source('Left', 'left');
  const right = source('Right', 'right');
  const state = setup([{uri: 'Shared.cs', text: 'right'}], [left, right]);
  state.frameId = 2;
  state.debug.frames = [{id: 1, source: left.uri}, {id: 2, source: right.uri, line: 4, column: 1}];
  state.breakpoints = {'Shared.cs': [{line: 4}]};
  const binding = {uri: right.uri, requestedLine: 4, verified: true};
  state.debug.breakpoints = [binding];
  assert.equal(debugSourceForWorkspace(state, 'Shared.cs').uri, right.uri);
  assert.equal(debugBreakpointRows(state)[0].binding, binding);
  const calls = [];
  navigateDebugSource({state, openFile: uri => calls.push(uri), getEditor: () => ({gotoLine: () => {}})}, state.debug.frames[1]);
  assert.deepEqual(calls, ['Shared.cs']);
});

test('source record publication is atomic and legacy single-module symbol maps remain supported', () => {
  const state = setup([{uri: 'Program.cs', text: 'text'}], [{uri: 'Program.cs', text: 'text'}]);
  const original = state.debugSources;
  assert.throws(() => setDebugSources(state, [{uri: 'X', text: 'one'}, {uri: 'X', text: 'two'}]), /Conflicting/);
  assert.equal(state.debugSources, original);
  state.debugSources = new Map([['Program.cs', 'text']]);
  state.debugSourceRecords.clear();
  assert.equal(workspaceFileForDebugSource(state, 'Program.cs'), state.files[0]);
  assert.equal(debugSourceForWorkspace(state, 'Program.cs').uri, 'Program.cs');
  state.debugSources.clear();
  assert.equal(workspaceFileForDebugSource(state, 'Program.cs'), null);
  const panels = [];
  state.debug.profile = 'managed-il';
  assert.equal(navigateDebugSource({state, setPanel: panel => panels.push(panel)}, {uri: 'missing'}).kind, 'unavailable');
  assert.deepEqual(panels, ['disassembly']);
});

test('worker source publication retains graph provenance without transferring metadata tables', () => {
  const record = {...source('Library', 'code'), project: 'Library.csproj', contextId: 'net10', generated: true, internal: 'private'};
  const output = runtimeSourceRecords({vm: {image: {sources: [record]}}});
  assert.deepEqual(output, [{uri: record.uri, text: 'code', originalUri: 'Shared.cs', assemblyKey: 'Library',
    project: 'Library.csproj', contextId: 'net10', generated: true}]);
  assert.equal(output[0].internal, undefined);
});
