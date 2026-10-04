import test from 'node:test';
import assert from 'node:assert/strict';
import {appRuntimeTree, appWindowDescriptors} from '../apps/studio/designer-app-host-tree.js';

test('runtime outline follows visual references, handles sharing/cycles, and preserves actual ids', () => {
  const nodes = new Map([
    ['window', {id: 'window', type: 'Xaml.Window', properties: {Title: 'My app', Content: {$ref: 'panel'}}}],
    ['panel', {id: 'panel', type: 'Controls.StackPanel', collections: {Children: [{$ref: 'button'}, {$ref: 'button'}]}}],
    ['button', {id: 'button', type: 'Controls.Button', properties: {Name: 'Run', Content: {$ref: 'window'}, Style: {$ref: 'style'}}}],
    ['style', {id: 'style', type: 'Xaml.Style', properties: {}}]
  ]);
  const roots = appRuntimeTree(nodes, ['window']);
  assert.equal(roots[0].id, 'window');
  assert.equal(roots[0].label, 'Window · My app');
  assert.equal(roots[0].children[0].children.length, 1);
  const button = roots[0].children[0].children[0];
  assert.equal(button.runtimeId, 'button');
  assert.equal(button.label, 'Button · Run');
  assert.deepEqual(button.children, []);
  assert.deepEqual(appWindowDescriptors(nodes, ['window', 'removed']), [{id: 'window', title: 'My app'}]);
});

test('runtime outline rejects unbounded depth and node counts', () => {
  const nodes = new Map();
  for (let index = 0; index < 130; index++) nodes.set(String(index), {
    id: String(index), type: 'Controls.Border', properties: {Child: {$ref: String(index + 1)}}
  });
  assert.throws(() => appRuntimeTree(nodes, ['0']), {code: 'SFDA0014'});
  assert.throws(() => appRuntimeTree(new Map(Array.from({length: 20_001}, (_, index) => [index, {}])), []), {code: 'SFDA0014'});
});
