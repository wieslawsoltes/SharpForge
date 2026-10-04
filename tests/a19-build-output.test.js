import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildServices } from '../apps/studio/workbench/build.js';
import { BuildQueue, projectBuildOrder } from '../apps/studio/workbench/build-queue.js';
import { OutputChannels } from '../apps/studio/workbench/output-channels.js';
import { DiagnosticsStore } from '../apps/studio/workbench/diagnostics-store.js';
import { RevealPolicy } from '../apps/studio/workbench/build-reveal.js';
import { fakeWorkers, compileResult, settle } from './a19-session-fixtures.js';

test('project builds run independently and only the edited project rejects its stale result', async () => {
  const fake = fakeWorkers();
  const diagnostics = new DiagnosticsStore();
  const builds = new BuildServices({ workerFactory: fake.factory, diagnostics });
  const a = builds.register({ id: 'A', files: [{ uri: 'A.cs', text: 'a', version: 1 }] });
  const b = builds.register({ id: 'B', files: [{ uri: 'B.cs', text: 'b', version: 1 }] });
  const pendingA = a.build();
  const pendingB = b.build();
  a.invalidate();
  fake.workers[0].reply(1, compileResult());
  fake.workers[1].reply(1, compileResult());
  await assert.rejects(pendingA, { code: 'BUILD_STALE' });
  assert.equal((await pendingB).success, true);
  assert.equal(a.result, null);
  assert.equal(b.assembly.length, 3);
  assert.equal(builds.activeId, 'A');
  assert.equal(a.busy, false);
  assert.equal(b.busy, false);
  builds.dispose();
  diagnostics.dispose();
});

test('live analysis cannot replace the cached executable returned by a clean build', async () => {
  const built = compileResult();
  const analysis = { success: true, diagnostics: [], symbols: [] };
  const fake = fakeWorkers(message => message.method === 'build' ? built : analysis);
  const builds = new BuildServices({ workerFactory: fake.factory });
  const project = builds.register({ id: 'A', files: [] });
  assert.equal(await project.build(), built);
  assert.equal(await project.analyze(), analysis);
  assert.equal(await project.build(), built);
  assert.equal(project.assembly, built.assembly);
  assert.deepEqual(fake.workers[0].requests.map(request => request.method), ['build', 'analyze']);
  builds.dispose();
});

test('cancelling one project terminates only its worker and preserves other project diagnostics', async () => {
  const fake = fakeWorkers();
  const diagnostics = new DiagnosticsStore();
  const builds = new BuildServices({ workerFactory: fake.factory, diagnostics });
  const a = builds.register({ id: 'A', files: [] });
  const b = builds.register({ id: 'B', files: [] });
  const pendingA = a.build();
  const pendingB = b.build();
  a.cancel();
  await assert.rejects(pendingA, { name: 'AbortError' });
  assert.equal(fake.workers[0].terminated, true);
  assert.equal(fake.workers[1].terminated, false);
  fake.workers[1].reply(1, compileResult(false));
  assert.equal((await pendingB).success, false);
  assert.equal(diagnostics.query({ projectId: 'B' }).length, 1);
  builds.remove('A');
  assert.equal(diagnostics.query({ projectId: 'B' }).length, 1);
  builds.dispose();
});

test('dependency order is deterministic and rejects cycles before executing work', () => {
  const projects = new Map([
    ['A', { dependencies: ['Common'] }], ['B', { dependencies: ['Common'] }], ['Common', { dependencies: [] }]
  ]);
  assert.deepEqual(projectBuildOrder(['A', 'B'], id => projects.get(id)), ['Common', 'A', 'B']);
  projects.get('Common').dependencies = ['A'];
  assert.throws(() => projectBuildOrder(['A'], id => projects.get(id)), { code: 'PROJECT_CYCLE' });
  assert.throws(() => projectBuildOrder(['Missing'], id => projects.get(id)), { code: 'PROJECT_MISSING' });
});

test('build queue cancellation skips remaining projects and reports exact counts', async () => {
  const fake = fakeWorkers();
  const output = new OutputChannels();
  const builds = new BuildServices({ workerFactory: fake.factory, output });
  builds.register({ id: 'A', files: [] });
  builds.register({ id: 'B', files: [], dependencies: ['A'] });
  const queue = new BuildQueue(builds, { output });
  const pending = queue.run(['B']);
  await settle();
  assert.equal(fake.workers[0].requests.length, 1);
  queue.cancel('A');
  const summary = await pending;
  assert.deepEqual(summary.cancelled, ['A']);
  assert.deepEqual(summary.skipped, ['B']);
  assert.deepEqual(summary.succeeded, []);
  assert.match(output.text('Build'), /0 succeeded, 0 failed, 1 skipped, 1 cancelled/);
  assert.equal(fake.workers[1].requests.length, 0);
  queue.dispose();
  builds.dispose();
  output.dispose();
});

test('output panes isolate applications and use bounded viewport reads after ring eviction', () => {
  const output = new OutputChannels({ maxEntries: 3, maxCharacters: 12, now: () => 99 });
  const a = output.program({ id: 'A', projectId: 'PA', name: 'App A' });
  const b = output.program({ id: 'B', projectId: 'PB', name: 'App B' });
  for (const text of ['one', 'two', 'three', 'four']) output.append(a, text);
  output.append(b, 'other');
  assert.equal(output.text(a), 'twothreefour');
  assert.equal(output.text(b), 'other');
  assert.deepEqual(output.read(a, { start: 1, count: 1 }).map(entry => entry.text), ['three']);
  assert.equal(output.get(a).dropped, 1);
  assert.equal(output.read(a)[0].timestamp, 99);
  output.clear(a);
  assert.equal(output.text(b), 'other');
  assert.equal(output.get(a).count, 0);
  assert.throws(() => output.read(b, { start: -1 }));
  output.dispose();
});

test('diagnostics remain project/producer/version scoped and combine query filters', () => {
  const store = new DiagnosticsStore();
  const fixture = Array.from({ length: 5000 }, (_, index) => ({
    uri: `File${index % 10}.cs`, code: `SF${index}`, message: `Problem ${index}`, start: index,
    severity: index % 2 ? 'warning' : 'error'
  }));
  store.replace('A', 'build', fixture, { revision: 4 });
  store.replace('A', 'analysis', [{ ...fixture[0], message: 'Live problem' }], { revision: 5 });
  store.replace('B', 'project', [{ ...fixture[0], message: 'Missing reference' }], { revision: 1 });
  assert.equal(store.replace('A', 'build', [], { revision: 3 }), false);
  assert.equal(store.query({ projectId: 'A', source: 'build', uri: 'File1.cs', severities: ['warning'] }).length, 500);
  assert.equal(store.query({ search: 'missing' }).length, 1);
  assert.equal(store.query({ projectId: 'A', source: 'analysis' })[0].message, 'Live problem');
  store.removeProject('A');
  assert.equal(store.query().length, 1);
  assert.throws(() => store.replace('B', 'unknown', []));
  store.dispose();
});

test('only current user intent may reveal panels; background work cannot steal focus', () => {
  const revealed = [];
  const policy = new RevealPolicy({ reveal: panel => revealed.push(panel), activeProject: () => 'A', activeSession: () => 'app-A' });
  const first = policy.userIntent();
  assert.equal(policy.request('problems', { projectId: 'A' }), false);
  assert.equal(policy.request('problems', { userInitiated: true, projectId: 'B' }), false);
  policy.userIntent();
  assert.equal(policy.request('problems', { userInitiated: true, projectId: 'A', intent: first }), false);
  assert.equal(policy.request('debug', { userInitiated: true, sessionId: 'app-A' }), true);
  assert.deepEqual(revealed, ['debug']);
});
