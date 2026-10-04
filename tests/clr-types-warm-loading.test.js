import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { graphContext, cyclicGraph } from './clr-types-graph-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

test('warm token and name lookup retain canonical ownership, cancellation and token validation', async () => {
  const owner = graphContext({ isCollectible: true });
  const module = (await owner.loadFromStream(managedFixture())).manifestModule;
  const type = await owner.types.load(module, 0x02000002);
  const caller = graphContext();
  for (const types of [owner.types, caller.types]) {
    assert.equal(await types.load(module, type.metadataToken), type);
    assert.equal(await types.find(module, type.fullName), type);
    assert.equal(type.loadContext, owner);
    await assert.rejects(types.load(module, type.metadataToken, { signal: AbortSignal.abort() }),
      error => error.code === LoadErrorCode.Cancelled);
    await assert.rejects(types.find(module, type.fullName, { signal: AbortSignal.abort() }),
      error => error.code === LoadErrorCode.Cancelled);
    for (const token of [0, -1, 1.5, NaN, 0x100000000, 0x102000002, 0x02000000, 0x0200ffff, {}, 1n]) {
      await assert.rejects(types.load(module, token), error => error.code === LoadErrorCode.InvalidImage);
    }
  }
  owner.unload();
  assert.equal(await caller.types.load(module, type.metadataToken), type);
  assert.equal(await owner.types.find(module, type.fullName), type);
  assert.equal(module.methodBodyReadCount, 0);
});

test('cold inheritance cycles remain detectable after warming another definition in the same module', async () => {
  const context = graphContext();
  const module = (await context.loadFromStream(cyclicGraph())).manifestModule;
  await context.types.load(module, 0x02000001);
  await assert.rejects(context.types.load(module, 0x02000002), /Circular inheritance/);
  await assert.rejects(context.types.find(module, 'Fixture.Program'), /Circular inheritance/);
  assert.equal(module.typeDefinition(0x02000002).isLoaded, false);
});
