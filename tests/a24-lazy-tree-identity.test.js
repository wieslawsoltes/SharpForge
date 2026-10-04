import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyExplorerTree} from '@sharpforge/project-system';

test('lazy folder construction rejects case aliases without replacing an existing directory identity', () => {
  const tree = new LazyExplorerTree({caseSensitive: false, folders: ['src']});
  const original = tree.directories.get('src');
  assert.throws(() => tree.addDirectory('SRC'), /identity collision/);
  assert.equal(tree.directories.get('src'), original);
  assert.equal(tree.directories.has('SRC'), false);
  assert.equal(tree.directories.get('').children.get('src').path, 'src');
  tree.dispose();
});

test('lazy folder construction refuses to shadow a file with a new parent directory', () => {
  const tree = new LazyExplorerTree({files: [{path: 'entry', size: 4}]});
  assert.throws(() => tree.addDirectory('entry/child'), /identity collision/);
  assert.equal(tree.files.get('entry').size, 4);
  assert.equal(tree.directories.get('').children.get('entry').type, 'file');
  assert.equal(tree.directories.size, 1);
  tree.dispose();
});

test('lazy paging keeps distinct case-sensitive directories and normalizes Unicode file identity', async () => {
  const tree = new LazyExplorerTree({folders: ['src', 'SRC'], files: [{path: 'src/café.cs'}]});
  assert.throws(() => tree.addFile({path: 'src/cafe\u0301.cs'}), /identity collision/);
  assert.deepEqual((await tree.root.loadChildren()).nodes.map(node => node.path), ['SRC', 'src']);
  assert.equal((await tree.loadChildren('src')).nodes[0].id, 'file:src/café.cs');
  tree.dispose();
});
