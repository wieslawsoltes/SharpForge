import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { contextFixture, referenceIndex } from './clr-context-fixtures.js';

test('CLR lazy first-use dependency graph tolerates A/B cycles and reports missing references only on use', async () => {
  const bytes = new Map([
    ['A', contextFixture('A', { references: ['B', 'Missing'] })],
    ['B', contextFixture('B', { references: ['A'] })],
  ]);
  const requests = [];
  const context = new AssemblyLoadSession().createContext({ load: ({ assemblyName }) => {
    requests.push(assemblyName.name);
    return bytes.get(assemblyName.name) ?? null;
  } });
  const first = await context.loadFromAssemblyName('A');
  assert.deepEqual(requests, ['A']);
  const second = await context.dependencies.resolve(first, await referenceIndex(first, 'B'));
  assert.equal(await context.dependencies.resolve(second, await referenceIndex(second, 'A')), first);
  assert.deepEqual(requests, ['A', 'B']);
  assert.equal(context.dependencies.edges(first)[0].target, second);
  await assert.rejects(first.resolveReference(await referenceIndex(first, 'Missing')),
    error => error.code === LoadErrorCode.MissingAssembly && error.requestingAssembly === first.fullName);
  assert.equal(first.referenceCount, 3);
});
