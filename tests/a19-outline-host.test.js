import test from 'node:test';
import assert from 'node:assert/strict';
import {OutlineReorder, installOutlineDrops} from '../apps/studio/workbench/tools/outline-reorder.js';

function fixture(request) {
  let file = {uri: 'a.cs', version: 1};
  const current = {uri: 'a.cs', projectId: 'p', workspaceEpoch: 2};
  const applied = [], navigated = [];
  const source = {symbol: {uri: 'a.cs', version: 1, start: 10}};
  const target = {symbol: {uri: 'a.cs', version: 1, start: 40}};
  const action = {version: 1, title: 'Move A', edits: [{uri: 'a.cs', version: 1, start: 0, end: 50, newText: 'moved'}],
    selection: {uri: 'a.cs', start: 30}};
  const controller = new OutlineReorder({request: request ?? (async () => action), documents: {get: () => file},
    context: () => current, applyEdits: async edits => applied.push(edits), navigate: async where => navigated.push(where)});
  return {controller, source, target, action, applied, navigated, current, file, replace: value => { file = value; }};
}

test('Outline host passes exact URI/project/version and applies one provider edit before navigation', async () => {
  const value = fixture(async (method, params, options) => {
    assert.equal(method, 'outlineReorder');
    assert.deepEqual(params, {uri: 'a.cs', version: 1, projectId: 'p', sourceStart: 10, targetStart: 40, position: 'after'});
    assert(options.signal instanceof AbortSignal);
    return value.action;
  });
  assert.equal(await value.controller.move(value.source, value.target, 'after'), true);
  assert.deepEqual(value.applied, [value.action.edits]);
  assert.deepEqual(value.navigated, [value.action.selection]);
  value.controller.dispose();
});

for (const change of ['version', 'project', 'workspace', 'document']) {
  test('Outline rejects stale ' + change + ' after provider completion', async () => {
    let finish;
    const value = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = value.controller.move(value.source, value.target);
    if (change === 'version') value.file.version++;
    if (change === 'project') value.current.projectId = 'q';
    if (change === 'workspace') value.current.workspaceEpoch++;
    if (change === 'document') value.replace({uri: 'a.cs', version: 1});
    finish(value.action);
    await assert.rejects(pending, /changed/);
    assert.equal(value.applied.length, 0);
    value.controller.dispose();
  });
}

test('Outline cancellation and disposal stop a waiting provider without applying its late result', async () => {
  const pendingRequests = [];
  const value = fixture((method, params, {signal}) => new Promise(resolve => pendingRequests.push({resolve, signal})));
  const first = value.controller.move(value.source, value.target);
  const firstCancelled = assert.rejects(first, {name: 'AbortError'});
  const second = value.controller.move(value.source, value.target);
  const secondCancelled = assert.rejects(second, {name: 'AbortError'});
  assert.equal(pendingRequests[0].signal.aborted, true);
  value.controller.dispose();
  await Promise.all([firstCancelled, secondCancelled]);
  for (const pending of pendingRequests) pending.resolve(value.action);
  await Promise.resolve();
  assert.equal(value.applied.length, 0);
});

test('Outline rejects read-only and mismatched provider edits', async () => {
  const value = fixture();
  value.file.readOnly = true;
  await assert.rejects(value.controller.move(value.source, value.target), /read-only/);
  value.file.readOnly = false;
  value.action.edits[0].uri = 'other.cs';
  await assert.rejects(value.controller.move(value.source, value.target), /invalid or stale/);
  assert.equal(value.applied.length, 0);
  value.controller.dispose();
});

test('Outline leaf drops retain before/after position and refuse cross-tree payloads', async () => {
  const listeners = new Map(), errors = [], moves = [];
  const source = {id: 'a', symbol: {}}, target = {id: 'b', symbol: {}, label: 'B'};
  const area = {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    contains: () => true};
  const tree = {area, status: {}, model: {nodes: new Map([['a', source], ['b', target]])}, view: {id: 'outline'}};
  const remove = installOutlineDrops(tree, {isCode: () => true, move: (...args) => moves.push(args), onError: error => errors.push(error)});
  const row = {dataset: {treeId: 'b'}, getBoundingClientRect: () => ({top: 20, height: 30})};
  let payload = {tree: 'outline', ids: ['a']};
  const event = {target: {closest: () => row}, clientY: 45, preventDefault() {}, stopPropagation() {},
    dataTransfer: {types: ['application/x-sharpforge-tree'], getData: () => JSON.stringify(payload)}};
  listeners.get('dragover')(event);
  await listeners.get('drop')(event);
  assert.deepEqual(moves, [[source, target, 'after']]);
  payload = {tree: 'other', ids: ['a']};
  listeners.get('dragover')(event);
  await listeners.get('drop')(event);
  assert.match(errors[0].message, /this outline/);
  assert.equal(moves.length, 1);
  remove();
  assert.equal(listeners.size, 0);
});
