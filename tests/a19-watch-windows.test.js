import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout } from '../packages/docking/src/index.js';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { ToolWindowFactories } from '../apps/studio/workbench/window-factories.js';
import { installWatchWindows } from '../apps/studio/workbench/watch-windows/index.js';
import { WatchWindowState } from '../apps/studio/workbench/watch-windows/state.js';
import { fakeWorkers, fakeRuntime, deferred, settle } from './a19-session-fixtures.js';
import { sessionDomRoot, descendants } from './a19-session-dom-fixture.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

async function fixture({ persisted = storage(), respond } = {}) {
  const workers = fakeWorkers((message, worker) => {
    if (message.method !== 'evaluate') return fakeRuntime(message, worker);
    return respond?.(message, worker) ?? {
      result: `${worker.options.name}:${message.params.expression}:${message.params.frameId}`, type: 'string'
    };
  });
  const services = createWorkbenchServices({ workerFactory: workers.factory });
  const alpha = services.sessions.create({ id: 'alpha', projectId: 'A', name: 'Alpha' });
  const beta = services.sessions.create({ id: 'beta', projectId: 'B', name: 'Beta' });
  for (const session of [alpha, beta]) {
    await session.launch({ image: {} });
    session.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', output: '', frames: [{ id: 7 }], stats: {} });
  }
  services.sessions.setActive(alpha.id);
  const layout = new DockLayout();
  const content = new Map();
  const host = { element: sessionDomRoot(), popouts: new Map(), autoPanel: null };
  const factories = new ToolWindowFactories({ layout, content });
  const docking = { layout, content, host, factories,
    registerToolKind: (...args) => factories.register(...args), createTool: (...args) => factories.create(...args),
    activate: id => layout.open(id), unregisterPanel: id => { layout.unregister(id); content.delete(id); } };
  const commands = createCommandRegistry();
  const errors = [];
  const watches = installWatchWindows({ docking, sessions: services.sessions, commands, storage: persisted,
    onError: error => errors.push(error) });
  const finish = () => { watches.dispose(); commands.dispose(); services.dispose(); };
  return { services, alpha, beta, layout, content, factories, commands, watches, errors, persisted, finish };
}

test('Watch 2 is an executable user command with independent expressions/results and explicit application scope', async () => {
  const f = await fixture();
  assert(f.commands.search('Watch 2').some(command => command.id === 'window.watch2'));
  const two = await f.commands.execute('window.watch2');
  const second = f.watches.get(two).model;
  await second.add('alphaValue');
  assert.equal(second.values.get('alphaValue').result, 'runtime:alpha:alphaValue:7');
  const three = f.watches.open(3, { sessionId: f.beta.id });
  const third = f.watches.get(three).model;
  await third.add('betaValue');
  assert.equal(third.values.get('betaValue').result, 'runtime:beta:betaValue:7');
  assert.deepEqual(second.expressions, ['alphaValue']);
  assert.deepEqual(third.expressions, ['betaValue']);
  assert.deepEqual(f.alpha.watches, []);
  assert.deepEqual(f.beta.watches, []);
  assert.equal(f.services.sessions.activeId, f.alpha.id, 'A Watch selector does not select the global process');
  assert.notEqual(f.watches.get(two).element, f.watches.get(three).element);
  assert.throws(() => f.watches.open(5), /Invalid watch instance/);
  f.finish();
});

test('Watch controls add, scope and remove expressions while asynchronous values retain the input node', async () => {
  const f = await fixture();
  const id = f.watches.open(2);
  const { model, element } = f.watches.get(id);
  const input = descendants(element, node => node.attributes['aria-label'] === 'Add expression to Watch 2')[0];
  input.value = 'x';
  descendants(element, node => node.tagName === 'form')[0].dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  await model.settled;
  const expression = descendants(element, node => node.attributes['aria-label'] === 'Expression x in Watch 2')[0];
  const selector = descendants(element, node => node.attributes['aria-label'] === 'Watch 2 application')[0];
  selector.value = 'session:beta';
  selector.dispatchEvent(new Event('change'));
  await model.settled;
  assert.equal(model.values.get('x').result, 'runtime:beta:x:7');
  assert.equal(descendants(element, node => node.attributes['aria-label'] === 'Expression x in Watch 2')[0], expression);
  assert.equal(f.services.sessions.activeId, 'alpha');
  descendants(element, node => node.attributes['aria-label'] === 'Remove x from Watch 2')[0].dispatchEvent(new Event('click'));
  await model.settled;
  assert.deepEqual(model.expressions, []);
  assert.equal(f.errors.length, 0);
  f.finish();
});

test('pending application/frame results are aborted and never replace a newer window scope', async () => {
  const old = deferred();
  const f = await fixture({ respond: (message, worker) => worker.options.name === 'runtime:alpha' ? old.promise : undefined });
  const id = f.watches.open(2);
  const model = f.watches.get(id).model;
  const pending = model.add('value');
  await settle();
  await model.select('session:beta');
  assert.equal(model.values.get('value').result, 'runtime:beta:value:7');
  old.resolve({ result: 'stale Alpha result', type: 'string' });
  await pending;
  await settle();
  assert.equal(model.values.get('value').result, 'runtime:beta:value:7');
  f.beta.frameId = 8;
  f.beta.watchEpoch++;
  f.beta.emit('location', { frameId: 8 });
  await model.settled;
  assert.equal(model.values.get('value').result, 'runtime:beta:value:8');
  await f.beta.stop();
  assert.equal(model.values.size, 0);
  assert.match(model.status, /Pause/);
  f.finish();
});

test('hidden Watch windows do no evaluation or DOM writes for background output', async () => {
  const f = await fixture();
  const id = f.watches.open(2);
  const { model, element } = f.watches.get(id);
  await model.add('x');
  f.layout.close(id);
  const writes = () => descendants(element, () => true).reduce((count, node) => count + node.textWrites, element.textWrites);
  const before = writes();
  const requests = f.alpha.worker.worker.requests.length;
  for (let index = 0; index < 10000; index++) f.alpha.emit('output', { text: String(index) });
  f.alpha.watchEpoch++;
  f.alpha.emit('location', { frameId: 7 });
  await model.settled;
  assert.equal(f.alpha.worker.worker.requests.length, requests);
  assert.equal(writes(), before);
  f.watches.open(2);
  await model.settled;
  assert(f.alpha.worker.worker.requests.length > requests);
  f.finish();
});

test('factory registration before restore recreates exact Watch identity, layout and saved expressions', async () => {
  const persisted = storage();
  const f = await fixture({ persisted });
  const id = f.watches.open(2, { sessionId: f.beta.id });
  await f.watches.get(id).model.add('persistedExpression');
  f.layout.float(id, { x: 12, y: 24, width: 420, height: 240 });
  const snapshot = f.layout.snapshot();
  const serialized = [...persisted.values.values()][0];
  assert(!serialized.includes('runtime:beta'), 'Evaluation results must not be persisted');
  f.finish();
  const restored = await fixture({ persisted });
  assert.deepEqual(restored.factories.restore(snapshot.panelInstances), []);
  restored.layout.restore(snapshot);
  const current = restored.watches.get(id);
  await current.model.settled;
  assert.deepEqual(current.model.expressions, ['persistedExpression']);
  assert.equal(current.model.target, 'session:beta');
  assert.equal(current.model.values.get('persistedExpression').result, 'runtime:beta:persistedExpression:7');
  assert.equal(restored.layout.locate(id).floatingId, snapshot.floating[0].id);
  assert.deepEqual(restored.layout.state.floating, snapshot.floating);
  assert.equal(restored.layout.state.panelInstances[id].instance, 2);
  restored.finish();
});

test('closing retains the controller and explicit unregister/dispose releases it before reopening', async () => {
  const f = await fixture();
  const id = f.watches.open(2);
  const model = f.watches.get(id).model;
  await model.add('x');
  f.layout.close(id);
  assert.equal(f.watches.open(2), id);
  assert.equal(f.watches.get(id).model, model);
  f.layout.unregister(id);
  assert.equal(model.disposed, true);
  assert.equal(f.watches.get(id), undefined);
  f.watches.open(2);
  assert.notEqual(f.watches.get(id).model, model);
  assert.deepEqual(f.watches.get(id).model.expressions, ['x']);
  f.watches.dispose();
  assert.equal(f.commands.describe('window.watch2'), null);
  assert.equal(f.factories.factories.has('watch'), false);
  assert.equal(f.layout.panels.has(id), false);
  f.finish();
});

test('corrupt, oversized, duplicate and failed persisted writes are explicit and atomic', () => {
  const backend = storage();
  const errors = [];
  backend.setItem('sharpforge.watch-windows.v1', JSON.stringify({ version: 99, windows: {} }));
  const state = new WatchWindowState({ storage: backend, onError: error => errors.push(error) });
  assert.equal(errors.length, 1);
  state.set('tool:watch:2', { expressions: ['x'], target: 'active' });
  assert.throws(() => state.set('tool:watch:2', { expressions: ['x', 'x'], target: 'active' }), /Duplicate/);
  assert.throws(() => state.set('tool:watch:2', { expressions: ['x'.repeat(4097)], target: 'active' }), /1–4096/);
  assert.throws(() => state.set('tool:watch:5', { expressions: [], target: 'active' }), /identity/);
  assert.throws(() => state.set('tool:watch:2', { expressions: Array.from({ length: 129 }, (_, index) => String(index)), target: 'active' }));
  state.storage = { setItem() { throw new Error('Quota exceeded'); } };
  assert.throws(() => state.set('tool:watch:2', { expressions: ['new'], target: 'active' }), /Quota/);
  assert.deepEqual(state.get('tool:watch:2'), { expressions: ['x'], target: 'active' });
});
