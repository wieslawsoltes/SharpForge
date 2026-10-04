import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStudioEditors, studioWorkspaceIdentity } from '../apps/studio/services/editor-lifecycle.js';
import { nativeStudioHost } from './fixtures/a25-studio-native-owner.js';
import { attachNativeViews } from './fixtures/a25-studio-native-views.js';

test('native reset retires primary and secondary views through their owner without changing workspace identity', () => {
  const fixture = nativeStudioHost();
  const views = attachNativeViews(fixture);
  const { host, owner, counters } = fixture;
  const before = { files: owner.files, models: new Map(owner.models), baselines: new Map(owner.baselines), revision: owner.revision,
    identity: studioWorkspaceIdentity(host.state, 'native:/project') };
  const observed = [];
  host.documentEvents.subscribe(event => observed.push({ event, views: owner.views.size, editors: owner.editors.size,
    activeViews: owner.activeViews.size, annotations: host.annotations.get('first.cs').length,
    allDisposed: views.every(view => view.disposed) }));
  resetStudioEditors(host);
  assert.equal(counters.resets, 1);
  assert.deepEqual([...host.docking.content.keys()], ['git']);
  assert.deepEqual([...host.docking.host.contents.keys()], ['git']);
  assert.deepEqual([...host.docking.host.popouts.keys()], ['git']);
  assert.deepEqual(observed, [
    { event: { uri: 'first.cs', text: undefined }, views: 0, editors: 0, activeViews: 0, annotations: 0, allDisposed: true },
    { event: { type: 'reset' }, views: 0, editors: 0, activeViews: 0, annotations: 0, allDisposed: true }
  ]);
  assert.equal(studioWorkspaceIdentity(host.state, 'native:/project'), before.identity);
  assert.equal(owner.files, before.files);
  assert.deepEqual(owner.models, before.models);
  assert.deepEqual(owner.baselines, before.baselines);
  assert.equal(owner.revision, before.revision);
});

test('native reset preflights owner identity and cleanup capabilities before navigation or view effects', () => {
  for (const mode of ['owner', 'reset', 'metadata', 'notification']) {
    const fixture = nativeStudioHost();
    const views = attachNativeViews(fixture);
    if (mode === 'owner') fixture.host.editors = new Map();
    if (mode === 'reset') delete fixture.owner.resetEditors;
    if (mode === 'metadata') delete fixture.host.docking.tabs.metadata;
    if (mode === 'notification') fixture.host.documentEvents = { publish() {} };
    assert.throws(() => resetStudioEditors(fixture.host), TypeError);
    assert.deepEqual(fixture.effects, []);
    assert.ok(views.every(view => !view.disposed));
    assert.equal(fixture.owner.views.size, 1);
    assert.equal(fixture.host.state.workspaceEpoch, 11);
    assert.equal(fixture.host.annotations.get('first.cs').length, 1);
    assert.deepEqual(fixture.events, []);
  }
});

test('native cleanup failures preserve the original error while attempting remaining retirement effects', () => {
  const failure = new Error('View state could not be saved');
  const fixture = nativeStudioHost();
  const views = attachNativeViews(fixture, { resetError: failure });
  assert.throws(() => resetStudioEditors(fixture.host, { newWorkspace: false }), error => error === failure);
  assert.ok(views.every(view => view.disposed));
  assert.equal(fixture.owner.views.size, 0);
  assert.deepEqual([...fixture.host.docking.content.keys()], ['git']);
  assert.equal(fixture.host.annotations.get('first.cs').length, 0);
  assert.deepEqual(fixture.events.map(item => item.event), [{ uri: 'first.cs', text: undefined }, { type: 'reset' }]);
  assert.equal(fixture.host.state.workspaceEpoch, 11);
});

test('native reset leaves central owner notification delivery to a host without an A25 event channel', () => {
  const fixture = nativeStudioHost();
  const views = attachNativeViews(fixture);
  delete fixture.host.documentEvents;
  resetStudioEditors(fixture.host);
  assert.equal(fixture.counters.resets, 1);
  assert.ok(views.every(view => view.disposed));
  assert.deepEqual(fixture.events, []);
});
