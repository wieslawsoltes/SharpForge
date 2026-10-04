import test from 'node:test';
import assert from 'node:assert/strict';
import { RetainedWinUIHost } from '../packages/winui-controls/src/host/retained-host.js';
import { HostComposition } from '../packages/winui-controls/src/host/composition.js';

function fixture(faults = new Set()) {
  const calls = [];
  const action = name => () => { calls.push(name); if (faults.has(name)) throw new Error(name); };
  const node = id => ({ id, type: 'Control', properties: {}, events: [], collections: {} });
  const host = Object.assign(Object.create(RetainedWinUIHost.prototype), {
    nodes: new Map(['removed', 'owner', 'child', 'popup', 'survivor'].map(id => [id, node(id)])),
    elements: new Map(), surfaces: new Map(), states: new Map(), layouts: new Map(), privateValues: new Map(),
    parents: new Map([['removed', 'owner'], ['child', 'removed']]),
    worldLayout: new Map([['removed', {}]]), portalTransforms: new Map([['removed', []]]),
    windows: ['removed', 'owner'], pendingFlyouts: [{ id: 'popup', anchor: 'removed' },
      { id: 'removed', anchor: 'owner' }, { id: 'survivor', anchor: 'owner' }],
    openFlyouts: new Map([['removed', 'owner'], ['popup', 'removed'], ['survivor', 'owner']]),
    options: { onElementRemoved: action('elementRemoved'), renderComposition: action('composition') },
    context: {}, registry: { resolve: () => ({ dispose: action('renderer') }) },
    eventRequests: { cancelTarget: action('requests') }, eventRouter: { removeNode: action('router') },
    input: { removeNode: action('input'), dragDrop: { removeNode: action('drag') } },
    automation: { remove: action('automation'), bridge: { remove: action('bridge') } },
    resizeObserver: { unobserve: action('unobserve') },
    services: { objectTree: { remove: action('objectTree') } },
    layoutEngine: { states: new Map([
      ['removed', { parent: 'owner', children: ['child'] }], ['owner', { parent: null, children: ['removed'] }],
      ['child', { parent: 'removed', children: [] }]
    ]), roots: ['removed', 'owner'], dirty: new Set(['removed', 'owner']),
    dependencies: new Map([['removed', new Set(['owner'])], ['owner', new Set(['removed'])]]), invalidate: action('invalidate') },
    scheduled: 0, schedule() { this.scheduled++; }
  });
  host.nodes.get('owner').templateRoot = 'removed';
  host.nodes.get('child').templateOwner = 'removed';
  const element = { remove: action('element') };
  host.elements.set('removed', element);
  host.elements.set('popup', { hidden: false });
  host.elements.set('survivor', { hidden: false });
  host.states.set('removed', { dispose: action('state'), scrollModel: { dispose: action('scroll') } });
  host.surfaces.set('removed', { dispose: action('surface') });
  host.layouts.set('removed', [10, 10]);
  host.privateValues.set('removed', new Map([['Password', 'private']]));
  const overlay = { id: 'popup', anchor: element }, survivor = { id: 'survivor', anchor: {} };
  host.services.overlays = { entries: [overlay, survivor], dismiss(entry) {
    this.entries.splice(this.entries.indexOf(entry), 1); action('overlay')();
  } };
  host.composition = new HostComposition(host);
  for (const name of ['overrides', 'brushes', 'brushPaint', 'elements', 'cache']) host.composition[name].set('removed', {});
  return { host, calls, element, survivor };
}

test('retained template commands preserve identities and accept only bounded string references or null', () => {
  const { host } = fixture(), owner = host.nodes.get('owner'), part = host.nodes.get('removed');
  const element = host.elements.get('removed');
  host.apply([{ op: 'template', id: 'owner', root: 'removed' }, { op: 'templateOwner', id: 'removed', owner: 'owner' }]);
  assert.equal(host.nodes.get('owner'), owner);
  assert.equal(host.nodes.get('removed'), part);
  assert.equal(host.elements.get('removed'), element);
  assert.equal(part.templateOwner, 'owner');
  const maximum = 'x'.repeat(512);
  host.apply({ op: 'template', id: 'owner', root: maximum });
  assert.equal(owner.templateRoot, maximum);
  for (const value of [undefined, {}, [], 1, '', 'x'.repeat(513)]) {
    assert.throws(() => host.apply({ op: 'template', id: 'owner', root: value }), /Invalid template identity/);
    assert.throws(() => host.apply({ op: 'templateOwner', id: 'removed', owner: value }), /Invalid template identity/);
    assert.equal(owner.templateRoot, maximum);
    assert.equal(part.templateOwner, 'owner');
  }
  host.apply([{ op: 'template', id: 'owner', root: null }, { op: 'templateOwner', id: 'removed', owner: null }]);
  assert.equal(owner.templateRoot, null);
  assert.equal(part.templateOwner, null);
});

test('missing template targets still validate identities before ignoring an already removed owner', () => {
  const { host } = fixture();
  host.apply({ op: 'template', id: 'missing', root: null });
  assert.throws(() => host.apply({ op: 'template', id: 'missing', root: {} }), /Invalid template identity/);
  for (const id of [undefined, null, {}, 1, '', 'x'.repeat(513)]) {
    assert.throws(() => host.apply({ op: 'templateOwner', id, owner: null }), /Invalid template identity/);
    assert.throws(() => host.apply({ op: 'remove', id }), /Invalid scene identity/);
  }
  assert.equal(host.nodes.has('removed'), true);
});

test('retained removal completes graph portal and renderer cleanup despite independent disposal failures', () => {
  const faults = new Set(['renderer', 'state', 'scroll', 'unobserve', 'element', 'surface', 'bridge', 'elementRemoved', 'composition']);
  const { host, calls, survivor } = fixture(faults);
  assert.throws(() => host.apply({ op: 'remove', id: 'removed' }), error => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(value => value.message), [...faults]);
    return true;
  });
  for (const name of ['nodes', 'elements', 'states', 'surfaces', 'layouts', 'privateValues', 'parents', 'worldLayout', 'portalTransforms']) {
    assert.equal(host[name].has('removed'), false, name);
  }
  for (const name of ['overrides', 'brushes', 'brushPaint', 'elements', 'cache']) assert.equal(host.composition[name].has('removed'), false);
  assert.equal(host.nodes.get('owner').templateRoot, null);
  assert.equal(host.nodes.get('child').templateOwner, null);
  assert.deepEqual(host.windows, ['owner']);
  assert.deepEqual(host.pendingFlyouts, [{ id: 'survivor', anchor: 'owner' }]);
  assert.deepEqual([...host.openFlyouts], [['survivor', 'owner']]);
  assert.equal(host.elements.get('popup').hidden, true);
  assert.equal(host.elements.get('survivor').hidden, false);
  assert.deepEqual(host.services.overlays.entries, [survivor]);
  assert.equal(host.parents.has('child'), false);
  assert.equal(host.layoutEngine.states.has('removed'), false);
  assert.equal(host.layoutEngine.states.get('child').parent, null);
  assert.deepEqual(host.layoutEngine.states.get('owner').children, []);
  assert.deepEqual(host.layoutEngine.roots, ['owner']);
  assert.equal(host.layoutEngine.dirty.has('removed'), false);
  assert.equal(host.layoutEngine.dependencies.has('removed'), false);
  assert.equal(host.layoutEngine.dependencies.get('owner').has('removed'), false);
  for (const name of ['requests', 'input', 'router', 'drag', 'automation', 'objectTree', 'overlay']) assert(calls.includes(name), name);
  assert.equal(host.modelDirty, true);
  assert(host.scheduled > 0);
  host.apply({ op: 'remove', id: 'removed' });
  assert.equal(calls.filter(value => value === 'elementRemoved').length, 1);
});

test('visual eviction releases native resources while preserving retained scene and template ownership', () => {
  const { host } = fixture(), node = host.nodes.get('removed');
  host.removeElement('removed');
  for (const name of ['elements', 'states', 'surfaces', 'layouts', 'privateValues']) assert.equal(host[name].has('removed'), false, name);
  assert.equal(host.nodes.get('removed'), node);
  assert.equal(host.nodes.get('owner').templateRoot, 'removed');
  assert.equal(host.nodes.get('child').templateOwner, 'removed');
  assert(host.windows.includes('removed'));
  assert.equal(host.layoutEngine.states.has('removed'), true);
  assert.equal(host.openFlyouts.get('popup'), 'removed');
});
