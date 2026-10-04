import test from 'node:test';
import assert from 'node:assert/strict';
import { applySceneCommands } from '../packages/winui/src/scene-commands.js';

function fixture() {
  return { nodes: new Map(), elements: new Map(), surfaces: new Map(), layouts: new Map(),
    windows: [], pendingFlyouts: [], openFlyouts: new Map(), scheduled: 0,
    schedule() { this.scheduled++; }, load() {}, merge() {} };
}

test('legacy template commands preserve owner identity and detach a replaced template without resetting the scene', () => {
  const host = fixture();
  applySceneCommands(host, [{ op: 'create', id: 'owner', type: 'Microsoft.UI.Xaml.Controls.Button' },
    { op: 'create', id: 'part', type: 'Microsoft.UI.Xaml.Controls.Border' }]);
  const owner = host.nodes.get('owner');
  applySceneCommands(host, [{ op: 'template', id: 'owner', root: 'part' },
    { op: 'templateOwner', id: 'part', owner: 'owner' }]);
  assert.equal(host.nodes.get('owner'), owner);
  assert.equal(owner.templateRoot, 'part');
  assert.equal(host.nodes.get('part').templateOwner, 'owner');
  applySceneCommands(host, { op: 'template', id: 'owner', root: null });
  assert.equal(owner.templateRoot, null);
  assert.throws(() => applySceneCommands(host, { op: 'template', id: 'owner', root: {} }), /template identity/);
});

test('removal releases DOM observation surfaces layout portals and template references even when disposal faults', () => {
  const host = fixture();
  const calls = [];
  host.nodes.set('removed', { templateRoot: null });
  host.nodes.set('owner', { templateRoot: 'removed', templateOwner: 'removed' });
  const popup = { hidden: false };
  host.elements.set('popup', popup);
  host.elements.set('removed', { remove() { calls.push('remove'); } });
  host.resizeObserver = { unobserve() { calls.push('unobserve'); } };
  host.surfaces.set('removed', { dispose() { calls.push('dispose'); throw new Error('device failure'); } });
  host.layouts.set('removed', [10, 10]);
  host.windows.push('removed');
  host.openFlyouts.set('popup', 'removed');
  host.pendingFlyouts.push({ id: 'popup', anchor: 'removed' });
  assert.throws(() => applySceneCommands(host, { op: 'remove', id: 'removed' }), AggregateError);
  assert.deepEqual(calls, ['unobserve', 'remove', 'dispose']);
  for (const name of ['nodes', 'elements', 'surfaces', 'layouts']) assert.equal(host[name].has('removed'), false);
  assert.equal(host.nodes.get('owner').templateRoot, null);
  assert.equal(host.nodes.get('owner').templateOwner, null);
  assert.deepEqual(host.windows, []);
  assert.deepEqual(host.pendingFlyouts, []);
  assert.equal(host.openFlyouts.size, 0);
  assert.equal(popup.hidden, true);
  applySceneCommands(host, { op: 'remove', id: 'removed' });
});
