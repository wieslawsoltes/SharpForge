import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFixture, element, panel } from './helpers/a16-layout.js';
import { reachableNodes, updateHostLayout } from '../packages/winui-controls/src/host/root-ownership.js';
import { computeWorldLayout } from '../packages/winui-controls/src/layout/dom-applier.js';

test('detached overlay owner and template parts share retained layout with portal placement', () => {
  const fixture = layoutFixture([panel('root', 'Grid', []), panel('overlay', 'StackPanel', ['part']),
    element('part', { Width: 70, Height: 30 })]);
  const entry = { id: 'overlay', modal: false, wrapper: { getBoundingClientRect: () => ({ left: 60, top: 40 }) } };
  const host = { nodes: fixture.nodes, windows: ['root'], openFlyouts: new Map(), layoutEngine: fixture.engine,
    services: { overlays: { entries: [entry], position() {} } }, elements: new Map(),
    root: { clientWidth: 300, clientHeight: 200, getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }) },
    visualChildren: node => (node.collections.Children ?? []).map(value => value.$ref) };
  assert.deepEqual([...reachableNodes(host)], ['root', 'overlay', 'part']);
  updateHostLayout(host);
  const world = computeWorldLayout(fixture.engine, { rootTransform: id => host.portalTransforms.get(id) });
  assert.deepEqual(world.get('overlay').bounds, { x: 50, y: 20, width: 70, height: 30 });
  assert.deepEqual(world.get('part').bounds, { x: 50, y: 20, width: 70, height: 30 });
  host.services.overlays.entries = [];
  updateHostLayout(host);
  assert.deepEqual(fixture.engine.roots, ['root']);
});
