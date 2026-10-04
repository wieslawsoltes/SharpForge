import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRuntimeLayout} from '../apps/studio/runtime-worker-layout.js';
import {connectRuntimeWorker} from './a19-runtime-worker-client.js';
import {viewportCompilation} from './fixtures/a18-adaptive-viewport.js';

test('layout registration preserves the debugger pause boundary and schedules only accepted measurements', () => {
  const handlers = new Map();
  const history = [];
  const vm = {state: 'paused', platform: {updateLayout(changes) {
    history.push(['layout', changes]);
    if (changes[0]?.invalid) throw new TypeError('Invalid visual layout measurement');
    vm.state = 'running';
    return changes.length;
  }}};
  registerRuntimeLayout({registerHandler: (name, callback) => handlers.set(name, callback)}, {
    session: () => ({vm}), state: () => history.push(['state', vm.state]), schedule: () => history.push(['schedule'])
  });
  const update = handlers.get('uiLayout');
  assert.equal(update({changes: [{width: 400}]}), 0);
  assert.deepEqual(history, []);
  vm.state = 'terminated';
  assert.throws(() => update({changes: [{invalid: true}]}), /measurement/);
  assert.equal(vm.state, 'terminated');
  assert.equal(history.length, 1);
  history.length = 0;
  assert.equal(update({changes: [{width: 600}]}), 1);
  assert.deepEqual(history, [['layout', [{width: 600}]], ['state', 'running'], ['schedule']]);
});

for (const managedIL of [false, true]) {
  test(`production ${managedIL ? 'direct CIL' : 'source image'} worker applies automatic adaptive geometry after Main and rejects retired windows`,
    async context => {
      const compiled = viewportCompilation(undefined, false);
      const worker = connectRuntimeWorker(context);
      await worker.ready();
      const launch = await worker.request('launch', {assembly: compiled.assembly, managedIL, debug: false});
      const current = event => event.event === 'state' && event.sessionId === launch.sessionId;
      const initial = await worker.wait(event => current(event) && ['terminated', 'faulted'].includes(event.state));
      assert.equal(initial.state, 'terminated', JSON.stringify(initial.fault ?? initial.reason));
      const first = await worker.request('uiScene', {sessionId: launch.sessionId});
      const id = first.windows[0];
      assert.ok(id);
      for (const [width, expected] of [[599.99, 100], [600, 240], [1000, 160]]) {
        worker.clear();
        assert.equal(await worker.request('uiLayout', {sessionId: launch.sessionId, changes: [{id, width, height: 640}]}), 1);
        const ended = await worker.wait(event => current(event) && ['terminated', 'faulted'].includes(event.state));
        assert.equal(ended.state, 'terminated', JSON.stringify(ended.fault ?? ended.reason));
        const scene = await worker.request('uiScene', {sessionId: launch.sessionId});
        assert.equal(scene.nodes.find(node => node.properties.Name === 'Action').properties.Width, expected);
        assert.equal(scene.windows.length, 1);
      }
      await worker.request('stop', {sessionId: launch.sessionId});
      assert.deepEqual((await worker.request('uiScene', {sessionId: launch.sessionId})).windows, []);
      await assert.rejects(worker.request('uiLayout', {sessionId: launch.sessionId, changes: [{id, width: 320, height: 640}]}),
        /Invalid visual layout measurement/);
    });
}
