import assert from 'node:assert/strict';
import { DefinitionBindings, definitionBindings } from '../packages/clr/src/generics/definition-bindings.js';
import { GenericResolutionContext } from '../packages/clr/src/generics/resolution-context.js';
import { openGenerics } from './clr-generics-instantiation-fixtures.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const maximumAttempts = 40;
const shared = await openGenerics();
const authority = new DefinitionBindings(1);

async function abandonedObservation() {
  const foreign = await openGenerics({ isCollectible: true }, { name: 'AbandonedClosureArgument' });
  const work = new GenericResolutionContext(1000, undefined, () => { throw new Error('Direct authority probe needs no monitor'); });
  const expected = definitionBindings(foreign.definitions.box, []);
  const subscription = authority.observe(shared.definitions.box, expected, work);
  foreign.context.onUnloading(() => { throw new Error('Earlier host listener failed'); });
  assert.throws(() => foreign.context.unload(), /Earlier host listener failed/);
  return { subscription, context: foreign.context,
    observed: [new WeakRef(foreign.context), new WeakRef(foreign.definitions.box), new WeakRef(work)] };
}

assert.equal(typeof globalThis.gc, 'function', 'This isolated authority ownership probe requires --expose-gc');
let retained = await abandonedObservation();
const observed = retained.observed;
await turn();
globalThis.gc();
assert.ok(retained.subscription && retained.context.isUnloading, 'Keep the live operation owner reachable through this assertion');
assert.ok(observed.every(reference => reference.deref()), 'A live root owns its own subscription and expected bindings');
retained = null;
let attempts = 0;
for (; attempts < maximumAttempts; attempts++) {
  await turn();
  globalThis.gc();
  if (observed.every(reference => reference.deref() === undefined)) break;
}
assert.ok(observed.every(reference => reference.deref() === undefined), 'A permanent definition must not root an abandoned consumer');
const next = new GenericResolutionContext(1000, undefined, () => {});
const admitted = authority.observe(shared.definitions.box, definitionBindings(null, []), next);
admitted.release();
next.dispose();
assert.equal(shared.definitions.box.isLoaded, false);
console.log(JSON.stringify({ format: 'sharpforge.generic-closure-authority-gc', forcedGc: true,
  maximumAttempts, attempts: attempts + 1, collected: observed.length, capacityReclaimed: true, permanentDefinitionRetained: true }));
