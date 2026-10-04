import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasScene, geometryHost} from './fixtures/a18-host-geometry-dom.js';

test('one position transaction updates and measures one existing control in a real 5000-node host', () => {
  const {host, rendered, measured} = geometryHost(canvasScene());
  const element = host.elements.get('item255');
  const neighbor = host.elements.get('item256');
  const revision = host.sceneRevision;
  host.nodes.values = () => { throw new Error('Full scene enumeration during a retained edit'); };
  assert.equal(host.tryPatchProperties([{id: 'item255', properties: {Left: 293, Top: 275}}]), true);
  host.flush();
  assert.deepEqual(rendered, [], 'An isolated fixed-size move must not invalidate the Canvas layout.');
  assert.deepEqual(measured, ['item255']);
  assert.equal(host.sceneRevision, revision + 1);
  assert.equal(host.nodes.size, 5000);
  assert.equal(host.elements.get('item255'), element);
  assert.equal(host.elements.get('item256'), neighbor);
  assert.equal(host.nodes.get('item255').properties.Left, 293);
  assert.equal(host.nodes.get('item255').properties.Top, 275);
  assert.equal(element.style.left, '255px');
  assert.equal(element.style.top, '255px');
  assert.equal(element.style.transform, 'translate(38px, 20px)');
  assert.equal(element.style.width, '140px');
  assert.equal(element.style.height, '40px');
  host.dispose();
});

test('property clearing and browser leaf resize notifications preserve exact geometry and avoid full rerender', () => {
  const {host, rendered, measured, layouts, reset} = geometryHost(canvasScene(4));
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Width: 248, Left: undefined}}]), true);
  host.flush();
  assert.equal(Object.hasOwn(host.nodes.get('item2').properties, 'Left'), false);
  assert.equal(host.elements.get('item2').style.left, '0px');
  assert.deepEqual(layouts, [[{id: 'item2', width: 248, height: 40}]]);
  const revision = host.sceneRevision;
  reset();
  host.geometryUpdates.resized([{target: host.elements.get('item2')}]);
  host.flush();
  assert.deepEqual(rendered, []);
  assert.deepEqual(measured, ['item2']);
  assert.equal(host.sceneRevision, revision, 'Size observation does not change scene content identity.');
  host.dispose();
});

test('flow, reference, drawing, structural and unknown-property fallbacks never partially mutate a batch', () => {
  const {host} = geometryHost(canvasScene(5));
  const original = structuredClone(host.nodes.get('item2').properties);
  const revision = host.sceneRevision;
  for (const unsafe of [
    {id: 'canvas', properties: {Width: 900}},
    {id: 'item3', properties: {Content: 'Different'}},
    {id: 'item3', properties: {Left: undefined, Top: undefined}},
    {id: 'missing', properties: {Width: 1}}
  ]) {
    assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 100}}, unsafe]), false);
    assert.deepEqual(host.nodes.get('item2').properties, original);
    assert.equal(host.sceneRevision, revision);
  }
  host.nodes.get('item3').templateRoot = 'item4';
  assert.equal(host.tryPatchProperties([{id: 'item3', properties: {Width: 200}}]), false);
  delete host.nodes.get('item3').templateRoot;
  host.nodes.get('item3').type = 'Microsoft.UI.Xaml.Shapes.Rectangle';
  assert.equal(host.tryPatchProperties([{id: 'item3', properties: {Width: 200}}]), false);
  host.nodes.get('canvas').type = 'Microsoft.UI.Xaml.Controls.Grid';
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Width: 200}}]), false);
  host.dispose();
});

test('external scene commands invalidate retained eligibility until one complete render rebuilds dependencies', () => {
  const {host, reset, rendered, measured} = geometryHost(canvasScene(4));
  const before = host.sceneRevision;
  host.apply({op: 'set', id: 'item2', property: 'Content', value: 'Runtime value'});
  assert(host.sceneRevision > before);
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 8}}]), false);
  assert.equal(host.nodes.get('item2').properties.Left, 2);
  host.flush();
  assert.equal(host.nodes.get('item2').properties.Content, 'Runtime value');
  reset();
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 8}}]), true);
  host.flush();
  assert.deepEqual(rendered, []);
  assert.deepEqual(measured, ['item2']);
  assert.equal(host.nodes.get('item2').properties.Left, 8);
  assert.equal(host.elements.get('item2').style.transform, 'translate(6px, 0px)');
  const replacement = canvasScene(4);
  replacement.nodes[1].type = 'Microsoft.UI.Xaml.Controls.StackPanel';
  host.load(replacement);
  host.flush();
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 9}}]), false);
  host.dispose();
});

test('viewport observation retains the full layout fallback without claiming a new source scene', () => {
  const {host, rendered} = geometryHost(canvasScene(4));
  const revision = host.sceneRevision;
  host.geometryUpdates.resized([{target: host.root}]);
  host.flush();
  assert.equal(rendered.length, 4);
  assert.equal(host.sceneRevision, revision);
  host.dispose();
});

test('retained updates are bounded, reject malformed batches and release pending frames and indexes on disposal', () => {
  const {host, frames} = geometryHost(canvasScene(4));
  assert.throws(() => host.tryPatchProperties(null), /10000 node records/);
  assert.throws(() => host.tryPatchProperties(Array(10001)), /10000 node records/);
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 10}}, {id: 'item2', properties: {Top: 20}}]), false);
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 10}}]), true);
  assert.equal(frames.size, 1);
  host.dispose();
  assert.equal(frames.size, 0);
  assert.equal(host.geometryUpdates.parents.size, 0);
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  assert.equal(host.tryPatchProperties([{id: 'item2', properties: {Left: 11}}]), false);
});
