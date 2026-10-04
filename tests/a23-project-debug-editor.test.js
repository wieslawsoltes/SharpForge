import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText} from '@sharpforge/text';
import {setDebugSources} from '../apps/studio/debug-sources.js';
import {decorateDebugEditors} from '../apps/studio/debug-editor-decorations.js';
import {createSourceBreakpointController} from '../apps/studio/debug-source-breakpoints.js';

const executionUri = 'sharpforge-assembly://Library/Shared.cs';
const text = '// 😀\r\n  return 42;\r\n';

function fixture() {
  const point = {uri: executionUri, line: 2, column: 3, endLine: 2, endColumn: 13};
  const state = {files: [{uri: 'Shared.cs', text}], debugSettings: {breakpointsEnabled: true},
    breakpoints: {'Shared.cs': [{line: 1, column: 1, enabled: true}]}, frameId: 2,
    result: {diagnostics: [{uri: 'Shared.cs', code: 'TEST', start: 0, length: 1}]},
    debug: {profile: 'source', state: 'paused', sessionId: 3, point, reason: {phase: 'before'},
      frames: [{id: 1, source: executionUri, line: 2}, {id: 2, source: executionUri, line: 1}],
      breakpoints: [{uri: executionUri, requestedLine: 1, requestedColumn: 1, line: 2, verified: true}]}};
  setDebugSources(state, [{uri: executionUri, originalUri: 'Shared.cs', assemblyKey: 'Library', text}]);
  return state;
}

function editorFor(text) {
  const recorded = {};
  return {recorded, setDiagnostics: value => { recorded.diagnostics = value; },
    setBreakpoints: value => { recorded.breakpoints = value; },
    sourceSnapshot: () => new SourceText(text),
    setExecutionLocation: (point, reason) => { recorded.point = point; recorded.reason = reason; },
    setSelectedFrameLine: line => { recorded.selectedLine = line; }};
}

test('editor decoration uses actual UTF-16 CRLF offsets and assembly-qualified breakpoint identity', () => {
  const state = fixture();
  const editor = editorFor(text);
  let banners = 0;
  decorateDebugEditors({state, editors: new Map([['Shared.cs', editor]]), updateBanner: () => { banners++; }});
  const {point, breakpoints, selectedLine, reason, diagnostics} = editor.recorded;
  assert.equal(point.start, text.indexOf('return'));
  assert.equal(point.end, text.indexOf(';') + 1);
  assert.equal(point.uri, 'Shared.cs');
  assert.equal(point.executionUri, executionUri);
  assert.equal(state.debug.point.uri, executionUri);
  assert.equal(breakpoints[0].uri, executionUri);
  assert.equal(breakpoints[0].verified, true);
  assert.equal(selectedLine, 1);
  assert.equal(reason.phase, 'before');
  assert.equal(diagnostics[0].code, 'TEST');
  assert.equal(banners, 1);
});

test('edited source withholds execution and selected-frame painting and unbound muted requests stay visible', () => {
  const state = fixture();
  state.files[0].text = 'changed';
  state.debugSettings.breakpointsEnabled = false;
  const editor = editorFor('changed');
  decorateDebugEditors({state, editors: new Map([['Shared.cs', editor]]), updateBanner() {}});
  assert.equal(editor.recorded.point, null);
  assert.equal(editor.recorded.selectedLine, null);
  assert.deepEqual(editor.recorded.breakpoints, [{line: 1, column: 1, enabled: true, verified: false, muted: true}]);
  state.debug = null;
  decorateDebugEditors({state, editors: new Map([['Shared.cs', editor]]), updateBanner() {}});
  assert.equal(editor.recorded.breakpoints[0].verified, undefined);
});

function controllerFor(state, overrides = {}) {
  const calls = [];
  const host = {state, request: async (method, params) => {
    calls.push({method, params});
    return params.breakpoints.map(item => ({...item, uri: params.uri, requestedLine: item.line, verified: true}));
  }, decorate() {}, render() {}, save: () => calls.push('saved'), editRule: async value => value,
  onError: error => calls.push({error}), ...overrides};
  return {controller: createSourceBreakpointController(host), calls};
}

test('toggling a moved binding removes its original workspace anchor without creating a qualified anchor key', async () => {
  const state = fixture();
  const {controller, calls} = controllerFor(state);
  await controller.toggle('Shared.cs', 2);
  assert.deepEqual(Object.keys(state.breakpoints), ['Shared.cs']);
  assert.deepEqual(state.breakpoints['Shared.cs'], []);
  assert.deepEqual(calls[0], {method: 'breakpoints', params: {uri: executionUri, breakpoints: [], sessionId: 3}});
  assert.deepEqual(state.debug.breakpoints, []);
  assert.equal(calls.includes('saved'), true);
});

test('editing a moved binding preserves its requested line and selected document mapping', async () => {
  const state = fixture();
  const {controller, calls} = controllerFor(state, {editRule: async (existing, title, options) => {
    assert.equal(existing.line, 1);
    assert.equal(title, 'Breakpoint · Shared.cs:1');
    assert.deepEqual(options, {source: true});
    return {...existing, condition: 'value == 42'};
  }});
  await controller.edit('Shared.cs', 2);
  assert.equal(state.breakpoints['Shared.cs'].length, 1);
  assert.equal(state.breakpoints['Shared.cs'][0].line, 1);
  assert.equal(calls[0].params.uri, executionUri);
  assert.equal(calls[0].params.breakpoints[0].condition, 'value == 42');
});

test('late breakpoint replies cannot replace a newer request or another runtime session', async () => {
  const state = fixture();
  const pending = [];
  const {controller} = controllerFor(state, {request: (method, params) => new Promise(resolve => pending.push({params, resolve}))});
  const first = controller.sync('Shared.cs');
  state.breakpoints['Shared.cs'][0].line = 2;
  const second = controller.sync('Shared.cs');
  assert.equal(pending[0].params.breakpoints[0].line, 1);
  pending[1].resolve([{uri: executionUri, requestedLine: 2}]);
  await second;
  pending[0].resolve([{uri: executionUri, requestedLine: 1}]);
  assert.equal(await first, null);
  assert.equal(state.debug.breakpoints[0].requestedLine, 2);
  const third = controller.sync('Shared.cs');
  state.debug = {...state.debug, sessionId: 4, breakpoints: []};
  pending[2].resolve([{uri: executionUri, requestedLine: 9}]);
  assert.equal(await third, null);
  assert.deepEqual(state.debug.breakpoints, []);
});

test('cancelled edits and unavailable runtime bindings preserve persisted requests', async () => {
  const state = fixture();
  const original = structuredClone(state.breakpoints);
  const failure = new Error('Runtime was disposed');
  const {controller, calls} = controllerFor(state, {editRule: async () => null,
    request: async () => { throw failure; }});
  assert.equal(await controller.edit('Shared.cs', 2), null);
  assert.deepEqual(calls, []);
  assert.equal(await controller.sync('Shared.cs'), null);
  assert.deepEqual(state.breakpoints, original);
  assert.equal(calls[0].error, failure);
});

test('late breakpoint failures cannot report into a newer request or session while current errors remain visible', async () => {
  for (const change of ['request', 'session', 'current']) {
    const state = fixture();
    const pending = [];
    const {controller, calls} = controllerFor(state, {request: () => {
      const deferred = Promise.withResolvers();
      pending.push(deferred);
      return deferred.promise;
    }});
    const first = controller.sync('Shared.cs');
    if (change === 'request') {
      const second = controller.sync('Shared.cs');
      pending[1].resolve([]);
      await second;
    }
    if (change === 'session') state.debug = {...state.debug, sessionId: 4};
    const failure = new Error('Old runtime request failed');
    pending[0].reject(failure);
    assert.equal(await first, null);
    assert.deepEqual(calls, change === 'current' ? [{error: failure}] : []);
  }
});
