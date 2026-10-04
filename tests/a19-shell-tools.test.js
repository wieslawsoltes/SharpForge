import test from 'node:test';
import assert from 'node:assert/strict';
import {scanCommentTasks} from '../apps/studio/workbench/tools/task-list.js';
import {hierarchicalSymbols} from '../apps/studio/workbench/tools/tree-host.js';
import {objectBrowserNodes} from '../apps/studio/workbench/tools/object-browser.js';
import {TestProviders, testTree} from '../apps/studio/workbench/tools/test-explorer.js';
import {CallHierarchyModel} from '../apps/studio/workbench/tools/call-hierarchy.js';
import {DiagnosticTimeline} from '../apps/studio/workbench/tools/diagnostic-timeline.js';
import {ToolboxProviders} from '../apps/studio/workbench/tools/toolbox.js';

test('Task List scans real C# comment trivia and ignores literal task words', async () => {
  const files = [{uri: 'a.cs', version: 1, text: 'class A { string x = "TODO: not a task"; // TODO: implement\n/* HACK: fix */ }'}];
  const rows = await scanCommentTasks(files, [{token: 'TODO', priority: 'normal'}, {token: 'HACK', priority: 'high'}]);
  assert.equal(rows.length, 2); assert.equal(rows[0].description, 'implement'); assert.equal(rows[1].priority, 'high');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(scanCommentTasks(files, [{token: 'TODO', priority: 'normal'}], {signal: controller.signal}), {name: 'AbortError'});
});

test('class hierarchy attaches members to their actual project and namespace', () => {
  const roots = hierarchicalSymbols([
    {id: 'a', projectId: 'p', name: 'A', kind: 'class', namespace: 'N'},
    {id: 'm', projectId: 'p', owner: 'A', name: 'Run', kind: 'method', detail: 'void A.Run()'}
  ]);
  assert.equal(roots[0].label, 'p'); assert.equal(roots[0].children[0].label, 'N');
  assert.equal(roots[0].children[0].children[0].children[0].symbol.name, 'Run');
});

test('Object Browser uses actual registered List metadata and method signatures', async () => {
  const roots = await objectBrowserNodes();
  const types = roots[0].children.flatMap(namespace => namespace.children);
  const list = types.find(type => type.id.includes('System.Collections.Generic.List'));
  assert(list, 'Registered List metadata must be present');
  assert(list.children.some(member => member.label === 'Add' && member.detail.includes('(')));
});

test('test provider subset runs emit incremental states and produce hierarchical results', async () => {
  const providers = new TestProviders(); const changes = [];
  providers.register('unit', {
    discover: async () => [{id: 'a', name: 'A', project: 'Project', namespace: 'N', className: 'Tests'}, {id: 'b', name: 'B'}],
    run: async (ids, {onResult}) => {
      assert.deepEqual(ids, ['a']);
      onResult({id: 'a', state: 'running'}); await Promise.resolve(); onResult({id: 'a', state: 'passed', duration: 2});
    }
  });
  providers.subscribe(event => { if (event.type === 'test-state') changes.push(event.test.state); });
  await providers.discover(); await providers.run(['unit:a']);
  assert.deepEqual(changes, ['queued', 'running', 'passed']);
  assert.equal(providers.tests.get('unit:b').state, 'not-run');
  const tree = testTree([...providers.tests.values()]);
  assert.equal(tree[0].children[0].children[0].children[0].test.id, 'unit:a');
  providers.dispose();
});

test('test cancellation signals only its current provider operation and preserves terminal results', async () => {
  const providers = new TestProviders(); let started;
  const running = new Promise(resolve => { started = resolve; });
  providers.register('unit', {discover: async () => [{id: 'a', name: 'A'}], run: async (ids, {signal, onResult}) => {
    onResult({id: 'a', state: 'running'}); started();
    await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
  }});
  await providers.discover();
  const pending = providers.run(); await running; providers.cancel();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(providers.tests.get('unit:a').state, 'cancelled'); providers.dispose();
});

test('call hierarchy expands lazily and rejects changed source versions', async () => {
  const file = {uri: 'a.cs', version: 1}; const requests = [];
  const model = new CallHierarchyModel({documents: {get: () => file}, request: async method => {
    requests.push(method);
    if (method === 'callHierarchy') return [{id: 'a', name: 'Run', uri: 'a.cs'}];
    return [{item: {id: 'b', name: 'Caller', uri: 'a.cs'}, ranges: [{uri: 'a.cs', start: 5, end: 8}]}];
  }});
  await model.prepare({uri: 'a.cs', offset: 0});
  assert.deepEqual(requests, ['callHierarchy']);
  await model.expand(model.roots[0].children[0]);
  assert.equal(model.roots[0].children[0].children[0].ranges[0].start, 5);
  file.version++;
  await assert.rejects(model.expand(model.roots[0].children[1]), /stale/); model.dispose();
});

test('diagnostic session timelines remain separate and heap diffs use actual census data', async () => {
  const timeline = new DiagnosticTimeline({clock: () => 1});
  timeline.record('a', {state: 'running', stats: {liveBytes: 10}}); timeline.record('b', {state: 'paused', stats: {liveBytes: 100}});
  assert.equal(timeline.sessions.get('a').samples[0].liveBytes, 10);
  let count = 0;
  const session = {id: 'a', request: async () => ++count === 1 ?
    {objects: 2, bytes: 20, types: [{type: 'A', objects: 2, bytes: 20}]} :
    {objects: 3, bytes: 32, types: [{type: 'A', objects: 3, bytes: 32}]}};
  const first = await timeline.snapshot(session), second = await timeline.snapshot(session);
  assert.deepEqual(timeline.diff('a', first.id, second.id), {objects: 1, bytes: 12, types: [{type: 'A', objects: 1, bytes: 12}]});
  assert.throws(() => timeline.diff('b', first.id, second.id), /same session/);
});

test('toolbox providers select the actual active document kind', async () => {
  const toolbox = new ToolboxProviders(); const inserted = [];
  for (const kind of ['code', 'designer']) toolbox.register(kind, {title: kind, matches: context => context.kind === kind,
    items: async () => [{id: kind, label: kind}], insert: item => inserted.push(item.id)});
  const items = await toolbox.items({kind: 'designer'}); assert.deepEqual(items.map(item => item.id), ['designer']);
  items[0].insert(); assert.deepEqual(inserted, ['designer']);
});
