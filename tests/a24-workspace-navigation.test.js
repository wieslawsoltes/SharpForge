import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationHistory} from '@sharpforge/editor';
import {createWorkspaceNavigation} from '../apps/studio/workspace-navigation.js';
import {createContextMenus} from '../apps/studio/menus/context.js';

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function navigationFixture(options) {
  const history = new NavigationHistory();
  for (const uri of ['A.cs', 'Removed.cs', 'B.cs', 'C.cs']) history.push({uri, start: 4, end: 7});
  const state = {identity: 'workspace:1', disk: {}, active: 'C.cs', replay: false, opened: [], renders: 0};
  const host = {
    history,
    context: () => ({identity: state.identity, disk: state.disk,
      records: ['A.cs', 'B.cs', 'C.cs'].map(path => ({path, lazy: path !== 'C.cs'}))}),
    currentLocation: () => ({uri: state.active, start: 12, end: 14}),
    openFile: async (...location) => { state.opened.push(location); state.active = location[0]; },
    setReplay: value => { state.replay = value; },
    renderButtons: () => { state.renders++; }
  };
  return {host, state, controller: createWorkspaceNavigation(host, options)};
}

test('Back/Forward preserves unloaded members and serializes lazy reads without recording duplicate history', async () => {
  const {host, state, controller} = navigationFixture();
  const entered = gate(), release = gate();
  const open = host.openFile;
  host.openFile = async (...location) => {
    if (location[0] === 'B.cs') { entered.resolve(); await release.promise; }
    assert.equal(state.replay, true);
    return open(...location);
  };
  const first = controller.navigate('back');
  await entered.promise;
  const second = controller.navigate('back');
  assert.equal(host.history.current.uri, 'C.cs');
  assert.deepEqual(state.opened, []);
  release.resolve();
  assert.equal((await first).uri, 'B.cs');
  assert.equal((await second).uri, 'A.cs');
  assert.deepEqual(state.opened, [['B.cs', 4, 7], ['A.cs', 4, 7]]);
  assert.equal(host.history.snapshot().entries.length, 4);
  assert.equal(host.history.current.uri, 'A.cs');
  assert.equal(state.replay, false);
  assert.equal((await controller.navigate('forward')).uri, 'B.cs');
  assert.equal(host.history.current.uri, 'B.cs');
  assert.deepEqual(state.opened.at(-1), ['B.cs', 12, 14]);
});

test('failed lazy navigation preserves history and clears replay before the next request', async () => {
  const {host, state, controller} = navigationFixture();
  const original = host.history.snapshot();
  const open = host.openFile;
  host.openFile = async () => { throw new Error('Folder permission revoked'); };
  await assert.rejects(controller.navigate('back'), /permission revoked/);
  assert.deepEqual(host.history.snapshot(), original);
  assert.equal(state.replay, false);
  host.openFile = open;
  assert.equal((await controller.navigate('back')).uri, 'B.cs');
});

test('workspace replacement invalidates queued history requests and reset releases their queue capacity', async () => {
  const {state, controller, host} = navigationFixture({maxPending: 1});
  const old = controller.navigate('back');
  const overflow = assert.rejects(controller.navigate('back'), /Too many pending/);
  state.identity = 'workspace:2';
  state.disk = {};
  controller.cancel();
  await overflow;
  assert.equal(await old, null);
  assert.deepEqual(state.opened, []);
  assert.equal((await controller.navigate('back')).uri, 'B.cs');
  assert.equal(host.history.current.uri, 'B.cs');
  await assert.rejects(controller.navigate('clear'), /Invalid history direction/);
});

test('history changed during a guarded open is never advanced using an obsolete snapshot', async () => {
  const {state, controller, host} = navigationFixture();
  const entered = gate(), release = gate();
  host.openFile = async () => { entered.resolve(); await release.promise; };
  const result = controller.navigate('back');
  await entered.promise;
  host.history.clear();
  host.history.push({uri: 'C.cs', start: 0});
  release.resolve();
  assert.equal(await result, null);
  assert.equal(host.history.current.uri, 'C.cs');
  assert.equal(state.replay, false);
});

test('Close Other Documents awaits each normal close hook before focusing the retained document', async () => {
  const state = {tabs: ['A.cs', 'B.cs', 'C.cs']};
  const first = gate(), second = gate(), entered = gate();
  const closed = [], released = [], opened = [];
  const context = {state, openFile: async uri => { opened.push(uri); }, docking: {
    layout: {require: () => ({kind: 'source'}), locate: () => ({}), groups: () => [], close: id => closed.push(id)},
    host: {async onClose(id) {
      if (id === 'source:A.cs') { entered.resolve(); await first.promise; }
      else await second.promise;
      state.tabs = state.tabs.filter(uri => 'source:' + uri !== id);
      released.push(id);
    }}
  }};
  const action = createContextMenus(context).dockMenuItems('source:B.cs').find(item => item?.label === 'Close Other Documents');
  const pending = action.action();
  await entered.promise;
  assert.deepEqual(closed, ['source:A.cs']);
  assert.deepEqual(opened, []);
  first.resolve();
  second.resolve();
  await pending;
  assert.deepEqual(closed, ['source:A.cs', 'source:C.cs']);
  assert.deepEqual(released, closed);
  assert.deepEqual(state.tabs, ['B.cs']);
  assert.deepEqual(opened, ['B.cs']);
});
