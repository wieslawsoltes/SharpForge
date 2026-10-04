import test from 'node:test';
import assert from 'node:assert/strict';
import {attachLazySymbols} from '@sharpforge/project-system';

function hierarchy() {
  const child = {id: 'source:View.xaml.cs', path: 'View.xaml.cs', label: 'View.xaml.cs', kind: 'source', children: []};
  const parent = {id: 'source:View.cs', path: 'View.cs', label: 'View.cs', kind: 'source', children: [child]};
  return {root: {kind: 'project', children: [parent]}, parent, child};
}

const symbols = [{uri: 'View.cs', name: 'View', id: 'view', kind: 'class'},
  {uri: 'View.xaml.cs', name: 'OnLoaded', owner: 'View', kind: 'method'}];

test('nested physical source children retain their own lazy symbol materializers', () => {
  const {root, parent, child} = hierarchy();
  attachLazySymbols(root, symbols);
  assert.equal(parent.children.length, 1);
  assert.equal(child.children.length, 0, 'collapsed nested source does not allocate its symbol nodes');
  const expanded = parent.loadChildren();
  assert.equal(expanded[0], child);
  assert.equal(expanded[1].label, 'View');
  assert.equal(typeof child.loadChildren, 'function');
  assert.equal(child.loadChildren()[0].label, 'OnLoaded()');
});

test('restored nested-file expansion materializes only that child and retains an empty parent symbol state', () => {
  const {root, parent, child} = hierarchy();
  attachLazySymbols(root, symbols, {expanded: new Set([child.id])});
  assert.equal(parent.children.length, 1);
  assert.equal(child.children.length, 1);
  assert.equal(child.children[0].label, 'OnLoaded()');
  assert.equal(child.children[0].path, 'View.xaml.cs');
});
