import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeForwarders } from '../packages/clr/src/resolve/forwarders.js';
import { LoadErrorCode } from '../packages/clr/src/index.js';

function facade(name, destination) {
  return {
    assembly: {
      identity: { name },
      ensureUsable() {},
      async resolveReference() { return { manifestModule: destination }; },
    },
    rowCount(table) { return table === 35 || table === 39 ? 1 : 0; },
    row() { return [0x00200000, 0, 1, 2, 5]; },
    string(index) { return index === 1 ? 'Outer' : 'Fixture'; },
  };
}

test('bounded forwarder cache publication does not retain a partial path after capacity failure', async () => {
  const target = { assembly: { ensureUsable() {} } };
  const middle = facade('Middle', target);
  const source = facade('Source', middle);
  const resolver = new TypeForwarders({ maxMetadataRows: 2, maxForwarderHops: 4, maxDepth: 8 });
  // The definition lookup is an injected seam; this test isolates export-cache capacity from TypeDef index budgets.
  const definition = module => module === target ? 0x02000001 : undefined;
  await resolver.resolve(middle, 'Fixture.Outer', definition);
  await resolver.resolve(middle, 'Fixture.Outer+One', definition);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(resolver.resolve(source, 'Fixture.Outer+Two', definition), error => {
      assert.equal(error.code, LoadErrorCode.LimitExceeded);
      assert.match(error.message, /binding count exceeded/);
      return true;
    });
  }
  assert.equal((await resolver.resolve(source, 'Fixture.Outer', definition)).module, target);
});
