import test from 'node:test';
import assert from 'node:assert/strict';
import { studioRevealFixture } from './support/studio-reveal-fixture.js';
import { compileResult, deferred, settle } from './a19-session-fixtures.js';

test('background build failure never reveals a tool or changes user intent', async context => {
  const scope = studioRevealFixture(context, { build: () => compileResult(false) });
  const intent = scope.services.reveal.intent;
  assert.equal((await scope.execution.build(true)).success, false);
  assert.equal(scope.services.reveal.intent, intent);
  assert.deepEqual(scope.revealed, []);
  assert.equal(scope.state.panel, 'properties');
});

test('an explicit build reveals its errors only while the initiating navigation remains current', async context => {
  const pending = deferred();
  const scope = studioRevealFixture(context, { build: () => pending.promise });
  const building = scope.execution.build();
  await settle();
  scope.setPanel('toolbox');
  pending.resolve(compileResult(false));
  await building;
  assert.deepEqual(scope.revealed, ['toolbox']);
  await scope.execution.build();
  assert.equal(scope.state.panel, 'problems');
});

test('an explicit build cannot reveal results for a project that is no longer selected', async context => {
  const pending = deferred();
  const scope = studioRevealFixture(context, { build: () => pending.promise });
  const building = scope.execution.build();
  await settle();
  scope.services.builds.setActive('B');
  pending.resolve(compileResult(false));
  await building;
  assert.deepEqual(scope.revealed, []);
});

test('late launch completion and stop-on-entry navigation respect a newer tool selection', async context => {
  const pending = deferred();
  const scope = studioRevealFixture(context, { build: () => pending.promise });
  const launching = scope.execution.launch();
  await settle();
  scope.setPanel('bookmarks');
  scope.state.active = 'B.cs';
  pending.resolve(compileResult());
  const result = await launching;
  const session = scope.services.sessions.get(result.started[0]);
  scope.emit(session, 'paused');
  assert.equal(scope.state.panel, 'bookmarks');
  assert.equal(scope.state.active, 'B.cs');
  assert.deepEqual(scope.revealed, ['bookmarks']);
  assert.deepEqual(scope.navigated, []);
});

test('a pending new-instance launch cannot replace an explicitly selected existing application', async context => {
  const pending = deferred();
  const scope = studioRevealFixture(context, { build: () => pending.promise });
  scope.services.sessions.create({ projectId: 'A' });
  const other = scope.services.sessions.create({ projectId: 'C' }, { activate: false });
  const launching = scope.execution.startNewInstance('B');
  await settle();
  scope.services.sessions.setActive(other.id);
  pending.resolve(compileResult());
  const result = await launching;
  assert.equal(scope.services.sessions.get(result.started[0]).projectId, 'B');
  assert.equal(scope.services.sessions.active, other);
  assert.deepEqual(scope.revealed, []);
});

test('a current launch may reveal its source and application without invalidating its own ticket', async context => {
  const scope = studioRevealFixture(context);
  const result = await scope.execution.launch();
  const session = scope.services.sessions.get(result.started[0]);
  const intent = scope.services.reveal.intent;
  scope.emit(session, 'paused');
  assert.equal(scope.navigated.length, 1);
  assert.equal(scope.state.active, 'A.cs');
  assert.equal(scope.state.panel, 'debug');
  assert.equal(scope.services.reveal.intent, intent);
  assert.equal(scope.execution.reveals.application(session.id, () => scope.setPanel('app:' + session.id)), true);
  assert.equal(scope.services.reveal.intent, intent);
  scope.setPanel('toolbox');
  assert.equal(scope.execution.reveals.application(session.id, () => scope.setPanel('app:' + session.id)), false);
});

test('faults, exits and verified-symbol source cannot override later user navigation', async context => {
  const scope = studioRevealFixture(context);
  const result = await scope.execution.launch();
  const session = scope.services.sessions.get(result.started[0]);
  scope.state.debugSources.set('Embedded.cs', '// verified');
  scope.setPanel('task-list');
  scope.emit(session, 'paused', { uri: 'Embedded.cs', line: 2, column: 1 });
  scope.emit(session, 'faulted');
  scope.emit(session, 'terminated');
  assert.equal(scope.state.panel, 'task-list');
  assert.deepEqual(scope.navigated, []);
  assert.deepEqual(scope.revealed, ['debug', 'task-list']);
});

test('current active-session faults may reveal output while foreign owners and worker serials are rejected', async context => {
  const scope = studioRevealFixture(context);
  const first = await scope.execution.launch();
  const a = scope.services.sessions.get(first.started[0]);
  const second = await scope.execution.startNewInstance('B');
  const b = scope.services.sessions.get(second.started[0]);
  const count = scope.revealed.length;
  assert.equal(scope.runtimeViews.completed({ appId: a.id, sessionId: a.identity }), false);
  assert.equal(scope.runtimeViews.completed({ appId: b.id, sessionId: b.runtimeSession }), false);
  assert.equal(scope.revealed.length, count);
  scope.emit(b, 'faulted');
  assert.equal(scope.state.panel, 'output');
});

test('continuing after navigation captures a new action without reviving earlier paused events', async context => {
  const scope = studioRevealFixture(context);
  const result = await scope.execution.launch();
  const session = scope.services.sessions.get(result.started[0]);
  scope.emit(session, 'paused');
  scope.setPanel('properties');
  const count = scope.navigated.length;
  scope.emit(session, 'paused');
  assert.equal(scope.navigated.length, count);
  await scope.execution.launch();
  scope.emit(session, 'paused');
  assert.equal(scope.navigated.length, count + 1);
  assert.equal(scope.state.panel, 'debug');
});

test('restart follows the new epoch while the previous worker identity remains unable to reveal', async context => {
  const scope = studioRevealFixture(context);
  const result = await scope.execution.launch();
  const session = scope.services.sessions.get(result.started[0]);
  const stale = scope.emit(session, 'paused');
  await scope.execution.restart();
  const count = scope.navigated.length;
  assert.equal(scope.runtimeViews.paused(stale), false);
  scope.emit(session, 'paused');
  assert.equal(scope.navigated.length, count + 1);
});

test('registered debug commands refresh follow intent; cancelled or unavailable commands do not authorize reveals', async context => {
  const scope = studioRevealFixture(context);
  const result = await scope.execution.launch();
  const session = scope.services.sessions.get(result.started[0]);
  scope.commands.registerCommand('next', 'Step over', 'F10', () => session.request('resume', { mode: 'over' }));
  scope.commands.registerCommand('disabled', 'Disabled', '', () => {}, { enabled: false });
  scope.setPanel('toolbox');
  const before = scope.services.reveal.intent;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scope.commands.invoke('next', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(scope.commands.execute('disabled'), /not available/);
  assert.equal(scope.services.reveal.intent, before);
  await scope.commands.execute('next');
  scope.emit(session, 'paused');
  assert.equal(scope.state.panel, 'debug');
});

test('main and detached document navigation invalidate pending reveals and listeners are disposed', context => {
  const scope = studioRevealFixture(context);
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const remove = scope.execution.reveals.install(document);
  assert.equal(scope.execution.reveals.install(document), remove);
  const intent = scope.services.reveal.intent;
  document.dispatchEvent(new Event('pointerdown'));
  assert.equal(scope.services.reveal.intent, intent + 1);
  const modifier = new Event('keydown');
  Object.defineProperty(modifier, 'key', { value: 'Shift' });
  document.dispatchEvent(modifier);
  assert.equal(scope.services.reveal.intent, intent + 1);
  const arrow = new Event('keydown');
  Object.defineProperty(arrow, 'key', { value: 'ArrowRight' });
  document.dispatchEvent(arrow);
  assert.equal(scope.services.reveal.intent, intent + 2);
  document.defaultView.dispatchEvent(new Event('unload'));
  assert.equal(scope.execution.reveals.documents.has(document), false);
  document.dispatchEvent(new Event('pointerdown'));
  document.dispatchEvent(arrow);
  assert.equal(scope.services.reveal.intent, intent + 2);
  remove();
  scope.execution.reveals.install(document);
  scope.execution.dispose();
  document.dispatchEvent(new Event('pointerdown'));
  document.dispatchEvent(arrow);
  assert.equal(scope.services.reveal.intent, intent + 2);
  assert.throws(() => scope.execution.reveals.install(document), /disposed/);
});

test('an explicit target starts even when the selected build project is a library', async context => {
  const scope = studioRevealFixture(context);
  scope.services.builds.get('A').project.outputType = 'library';
  scope.services.profiles.set('B', { id: 'cli', arguments: ['selected-B'] });
  const before = scope.services.startup.snapshot();
  const result = await scope.execution.startNewInstance('B');
  const session = scope.services.sessions.get(result.started[0]);
  assert.equal(session.projectId, 'B');
  assert.equal(session.profileId, 'cli');
  assert.deepEqual(session.lastLaunch.programArguments, ['selected-B']);
  assert.deepEqual(scope.services.startup.snapshot(), before);
});

test('stopping a pending launch revokes its later reveal without leaving an activation callback in worker options', async context => {
  const pending = deferred();
  const scope = studioRevealFixture(context, { build: () => pending.promise });
  const launching = scope.execution.launch();
  await settle();
  scope.setPanel('output');
  await scope.execution.stop({ all: true });
  pending.resolve(compileResult());
  const result = await launching;
  assert.deepEqual(result.started, []);
  assert.deepEqual(scope.revealed, ['output']);
  assert.equal(scope.services.launches.operations.size, 0);
  assert.equal(scope.execution.launchController, null);
  await scope.execution.launch();
  const session = scope.services.sessions.active;
  assert.equal(Object.hasOwn(session.lastLaunch, 'shouldActivate'), false);
});
