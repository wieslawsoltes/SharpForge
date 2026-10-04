import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorLanguageServices } from '@sharpforge/editor';
import { TestProviders } from '../apps/studio/workbench/tools/test-explorer.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { createTestCodeLensProvider } from '../apps/studio/workbench/test-code-lens.js';

const request = { uri: 'tests.cs', version: 3 };

function source(uri = 'tests.cs', version = 3) {
  return { uri, version, length: 100,
    get text() { throw new Error('Test CodeLens must not flatten current source'); } };
}

function definition(id = 'one', extra = {}) {
  return { id, name: 'Test ' + id, uri: 'tests.cs', version: 3, projectId: 'A', start: 8, end: 12, ...extra };
}

async function fixture({ definitions = [definition()], run, execute, attachBeforeDiscovery = false } = {}) {
  const tests = new TestProviders();
  const documents = new Map([['tests.cs', source()], ['other.cs', source('other.cs')]]);
  const projects = new Map([['tests.cs', ['A']], ['other.cs', ['B']]]);
  const calls = [];
  let discovered = definitions;
  const unregister = tests.register('suite', {
    discover: async () => discovered,
    run: run ?? (async (ids, { onResult }) => {
      calls.push([...ids]);
      for (const id of ids) {
        onResult({ id, state: 'running' });
        onResult({ id, state: 'passed', duration: 2.5 });
      }
    })
  });
  const create = () => createTestCodeLensProvider({ tests,
    getDocument: uri => documents.get(uri), projectIdsForUri: uri => projects.get(uri) ?? [], execute });
  let provider = attachBeforeDiscovery ? create() : null;
  await tests.discover();
  provider ??= create();
  return { tests, documents, projects, calls, provider, unregister,
    rediscover: async values => { discovered = values; await tests.discover(); },
    dispose() { provider.dispose(); tests.dispose(); } };
}

function command(provider, params = request, item = provider.codeLens(params).items[0]) {
  return { ...params, ...provider.resolveCodeLens({ ...params, lens: item }).command };
}

test('source-indexed lenses are unresolved and lazy, ordered, project-owned and never materialize document text', async () => {
  const current = await fixture({ attachBeforeDiscovery: true, definitions: [
    definition('later', { start: 30, end: 35 }), definition('first'),
    definition('foreign', { projectId: 'B' }), definition('missing', { uri: undefined }),
    definition('unversioned', { version: undefined, projectId: undefined, start: 15, end: 18 })
  ] });
  const result = current.provider.codeLens(request);
  assert.equal(result.uri, request.uri);
  assert.equal(result.version, request.version);
  assert.deepEqual(result.items.map(item => item.data.testId), ['suite:first', 'suite:unversioned', 'suite:later']);
  assert(result.items.every(item => !item.command && item.data.provider === 'tests' && item.data.projectId === 'A'));
  assert.deepEqual(current.calls, []);
  const resolved = current.provider.resolveCodeLens({ ...request, lens: result.items[0] });
  assert.equal(resolved.command.title, 'Not run · Test first');
  assert.deepEqual(resolved.command.arguments, [{ testId: 'suite:first', uri: 'tests.cs', version: 3, projectId: 'A' }]);
  assert.deepEqual(current.calls, []);
  current.dispose();
});

test('actual editor service command runs only the selected registry test through TaskCenter and refreshes real status', async () => {
  const tasks = new TaskCenter();
  const current = await fixture({ definitions: [definition(), definition('two', { start: 20, end: 24 })],
    execute: operation => tasks.run({ label: 'Run selected test' }, task => operation.run({ signal: task.signal })) });
  const services = new EditorLanguageServices({ codeLens: current.provider.codeLens,
    resolveCodeLens: current.provider.resolveCodeLens, executeCommand: current.provider.executeCommand });
  const result = await services.invoke('codeLens', request);
  const lens = result.items[0];
  const resolved = await services.invoke('resolveCodeLens', { ...request, lens });
  const titles = [];
  const events = [];
  current.provider.subscribe(event => {
    events.push(event);
    titles.push(current.provider.resolveCodeLens({ ...request, lens }).command.title);
  });
  await services.invoke('executeCommand', { ...request, ...resolved.command });
  assert.deepEqual(current.calls, [['one']]);
  assert.deepEqual(titles, ['Queued · Test one', 'Running · Test one', 'Passed · Test one (2.5 ms)', 'Passed · Test one (2.5 ms)']);
  assert.equal(events[0].uri, 'tests.cs');
  assert.equal(events.at(-1).reason, 'run-ended');
  assert.equal(current.tests.tests.get('suite:two').state, 'not-run');
  assert.equal(tasks.list()[0].status, 'completed');
  assert.deepEqual(resolved.data, lens.data);
  services.dispose();
  tasks.dispose();
  current.dispose();
});

test('real failed and skipped outcomes resolve with their observed state and do not fabricate timing', async () => {
  const current = await fixture({ definitions: [definition(), definition('two')], run: async (ids, { onResult }) => {
    onResult({ id: ids[0], state: ids[0] === 'one' ? 'failed' : 'skipped' });
  } });
  const items = current.provider.codeLens(request).items;
  for (const item of items) await current.provider.executeCommand(command(current.provider, request, item));
  assert.equal(current.provider.resolveCodeLens({ ...request, lens: items[0] }).command.title, 'Failed · Test one');
  assert.equal(current.provider.resolveCodeLens({ ...request, lens: items[1] }).command.title, 'Skipped · Test two');
  current.dispose();
});

test('forged or stale source, span, test and project identities cannot resolve or execute', async () => {
  const current = await fixture();
  const lens = current.provider.codeLens(request).items[0];
  const action = command(current.provider);
  for (const altered of [
    { ...lens, uri: 'other.cs' }, { ...lens, start: 9 }, { ...lens, end: 13 },
    { ...lens, data: { ...lens.data, provider: 'references' } },
    { ...lens, data: { ...lens.data, testId: 'suite:missing' } },
    { ...lens, data: { ...lens.data, version: 2 } },
    { ...lens, data: { ...lens.data, projectId: 'B' } }
  ]) assert.throws(() => current.provider.resolveCodeLens({ ...request, lens: altered }), { code: 'SFTEST1005' });
  for (const argument of [
    { ...action.arguments[0], testId: 'suite:missing' }, { ...action.arguments[0], uri: 'other.cs' },
    { ...action.arguments[0], version: 2 }, { ...action.arguments[0], projectId: 'B' }
  ]) await assert.rejects(current.provider.executeCommand({ ...action, arguments: [argument] }), { code: 'SFTEST1005' });
  current.documents.get('tests.cs').version++;
  assert.throws(() => current.provider.codeLens(request), { code: 'SFTEST1002' });
  await assert.rejects(current.provider.executeCommand(action), { code: 'SFTEST1002' });
  assert.deepEqual(current.provider.codeLens({ ...request, version: 4 }).items, []);
  current.documents.delete('tests.cs');
  assert.throws(() => current.provider.codeLens(request), /missing/);
  assert.deepEqual(current.calls, []);
  current.dispose();
});

test('linked documents require exact stable project ownership; a display label never selects a project', async () => {
  const current = await fixture({ definitions: [definition(), definition('inferred', { projectId: undefined }),
    definition('display', { projectId: 'Project A' })] });
  const action = command(current.provider);
  current.projects.set('tests.cs', ['A', 'B']);
  assert.deepEqual(current.provider.codeLens(request).items.map(item => item.data.testId), ['suite:one']);
  assert.deepEqual(current.provider.codeLens({ ...request, projectId: 'B' }).items, []);
  assert.throws(() => current.provider.codeLens({ ...request, projectId: 'Project A' }), { code: 'SFTEST1003' });
  current.projects.set('tests.cs', ['B']);
  await assert.rejects(current.provider.executeCommand(action), { code: 'SFTEST1005' });
  current.projects.set('tests.cs', []);
  assert.throws(() => current.provider.codeLens(request), { code: 'SFTEST1003' });
  current.dispose();
});

test('discovery invalidates moved locations and captures omitted versions only on actual rediscovery', async () => {
  const current = await fixture({ definitions: [definition('one', { version: undefined })] });
  const old = current.provider.codeLens(request).items[0];
  const events = [];
  current.provider.subscribe(event => events.push(event.reason));
  current.documents.get('tests.cs').version = 4;
  assert.deepEqual(current.provider.codeLens({ ...request, version: 4 }).items, []);
  await current.rediscover([definition('one', { version: undefined, start: 20, end: 24 })]);
  assert.deepEqual(events, ['discovered']);
  assert.equal(current.provider.codeLens({ ...request, version: 4 }).items[0].start, 20);
  assert.throws(() => current.provider.resolveCodeLens({ uri: request.uri, version: 4, lens: old }), { code: 'SFTEST1005' });
  current.dispose();
});

test('cancelling a lens run preserves an independent Test Explorer run and reports actual cancellation', async () => {
  const active = new Map();
  const current = await fixture({ definitions: [definition(), definition('two')], run: (ids, { signal, onResult }) => {
    onResult({ id: ids[0], state: 'running' });
    return new Promise(resolve => {
      active.set(ids[0], { signal, finish: () => { onResult({ id: ids[0], state: 'passed' }); resolve(); } });
      signal.addEventListener('abort', resolve, { once: true });
    });
  } });
  const controller = new AbortController();
  const lens = current.provider.codeLens(request).items[0];
  const first = current.provider.executeCommand(command(current.provider, request, lens), { signal: controller.signal });
  const second = current.tests.run(['suite:two']);
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(active.get('two').signal.aborted, false);
  assert.equal(current.provider.resolveCodeLens({ ...request, lens }).command.title, 'Cancelled · Test one');
  active.get('two').finish();
  await second;
  assert.equal(current.tests.tests.get('suite:two').state, 'passed');
  assert.equal(current.tests.runs.size, 0);
  current.dispose();
});

test('unregistering a real provider aborts its run, invalidates lenses and cannot leave a clickable old action', async () => {
  let signal;
  const current = await fixture({ run: async (ids, options) => {
    signal = options.signal;
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  } });
  const action = command(current.provider);
  const events = [];
  current.provider.subscribe(event => events.push(event.reason));
  const pending = current.provider.executeCommand(action);
  current.unregister();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  assert(events.includes('provider-removed'));
  assert.deepEqual(current.provider.codeLens(request).items, []);
  await assert.rejects(current.provider.executeCommand(action), { code: 'SFTEST1005' });
  current.dispose();
});

test('disposing CodeLens cancels only its runs, removes refresh listeners and rejects later requests', async () => {
  const active = new Map();
  const current = await fixture({ definitions: [definition(), definition('two')], run: (ids, { signal }) => new Promise(resolve => {
    active.set(ids[0], { signal, resolve });
    signal.addEventListener('abort', resolve, { once: true });
  }) });
  const events = [];
  current.provider.subscribe(event => events.push(event.reason));
  const first = current.provider.executeCommand(command(current.provider));
  const second = current.tests.run(['suite:two']);
  current.provider.dispose();
  const count = events.length;
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(active.get('two').signal.aborted, false);
  active.get('two').resolve();
  await second;
  assert.equal(events.length, count);
  assert.throws(() => current.provider.codeLens(request), { code: 'SFTEST1001' });
  assert.throws(() => current.provider.subscribe(() => {}), /disposed/);
  current.dispose();
});

test('an optional operation wrapper cannot bypass provider execution or reuse its delayed run after completion', async () => {
  let saved;
  const current = await fixture({ execute: operation => { saved = operation.run; return 'not executed'; } });
  await assert.rejects(current.provider.executeCommand(command(current.provider)), { code: 'SFTEST1007' });
  assert.throws(() => saved(), { code: 'SFTEST1007' });
  assert.deepEqual(current.calls, []);
  current.dispose();
});

test('deferred execution revalidates source and discovery ownership before starting the test', async () => {
  let release;
  let begin;
  const wait = new Promise(resolve => { release = resolve; });
  const current = await fixture({ execute: async operation => { begin = operation.run; await wait; return operation.run(); } });
  const pending = current.provider.executeCommand(command(current.provider));
  assert.equal(typeof begin, 'function');
  await current.rediscover([definition()]);
  release();
  await assert.rejects(pending, { code: 'SFTEST1005' });
  assert.deepEqual(current.calls, []);
  current.dispose();
});

test('provider errors still emit final invalidation and resolve to the actual failed registry state', async () => {
  const current = await fixture({ run: async () => { throw new Error('test process failed'); } });
  const events = [];
  current.provider.subscribe(event => events.push(event.reason));
  await assert.rejects(current.provider.executeCommand(command(current.provider)), /test process failed/);
  assert.equal(events.at(-1), 'run-ended');
  assert.equal(current.provider.resolveCodeLens({ ...request, lens: current.provider.codeLens(request).items[0] }).command.title,
    'Failed · Test one');
  assert.equal(current.tests.runs.size, 0);
  current.dispose();
});

test('pre-aborted requests and malformed commands fail before starting provider work', async () => {
  const current = await fixture();
  const action = command(current.provider);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => current.provider.codeLens({ ...request, signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(current.provider.executeCommand(action, { signal: controller.signal }), { name: 'AbortError' });
  for (const altered of [{ ...action, command: 'workbench.tests.run' }, { ...action, arguments: [] },
    { ...action, arguments: [action.arguments[0], action.arguments[0]] }]) {
    await assert.rejects(current.provider.executeCommand(altered), { code: 'SFTEST1007' });
  }
  assert.throws(() => current.provider.codeLens({ ...request, version: NaN }), { code: 'SFTEST1002' });
  assert.equal(current.tests.runs.size, 0);
  assert.deepEqual(current.calls, []);
  current.dispose();
});

test('document bounds and the editor lens cap reject unusable or excessive discoveries explicitly', async () => {
  const current = await fixture({ definitions: [definition('outside', { start: 99, end: 101 })] });
  assert.deepEqual(current.provider.codeLens(request).items, []);
  await current.rediscover(Array.from({ length: 5001 }, (_, index) => definition(String(index))));
  assert.throws(() => current.provider.codeLens(request), { code: 'SFTEST1004' });
  current.dispose();
});
