import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectBuildGraph, FastUpToDateCheck } from '@sharpforge/msbuild/node';

test('project graph changes rebuild only the owning node and transitive dependents', () => {
  const graph = new ProjectBuildGraph([
    { id: 'shared', project: 'Shared.csproj', inputs: ['Shared.cs'], dependencies: [] },
    { id: 'app', project: 'App.csproj', inputs: ['Program.cs'], dependencies: ['shared'] },
    { id: 'other', project: 'Other.csproj', inputs: ['Other.cs'], dependencies: [] }
  ]);
  assert.deepEqual(graph.affected(['Program.cs']).map(node => node.id), ['app']);
  assert.deepEqual(graph.affected(['Shared.cs']).map(node => node.id), ['shared', 'app']);
  assert.throws(() => new ProjectBuildGraph([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }]), /cycle/);
});
test('fast up-to-date check detects input and output changes with an explanation', async () => {
  const files = new Map([['source', { modified: 1, hash: 'a' }], ['output', { modified: 2, hash: 'b' }]]);
  const checker = new FastUpToDateCheck({ fingerprint: async path => files.get(path) });
  const paths = { inputs: ['source'], outputs: ['output'] };
  assert.equal((await checker.check('A', paths)).upToDate, false);
  await checker.record('A', paths);
  assert.equal((await checker.check('A', paths)).upToDate, true);
  files.set('source', { modified: 3, hash: 'c' });
  assert.match((await checker.check('A', paths)).reason, /Changed input/);
});
