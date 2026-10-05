import assert from 'node:assert/strict';
import { openGenerics } from './clr-generics-instantiation-fixtures.js';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const maximumAttempts = 40;

async function createCase(shared, kind) {
  const definitionOwner = kind === 'collectible-definition' || kind === 'two-collectible-contexts'
    ? await openGenerics({ isCollectible: true }, { name: 'CollectibleDefinition' }) : null;
  const argumentOwner = kind === 'collectible-definition'
    ? null : await openGenerics({ isCollectible: true }, { name: 'CollectibleArgument' });
  const definition = definitionOwner?.definitions.box ?? shared.definitions.box;
  const argument = argumentOwner
    ? await argumentOwner.types.load(argumentOwner.module, 0x02000002) : shared.types.intrinsic('System.Int32');
  const constructed = await shared.types.instantiate(definition, [argument]);
  let value = constructed;
  if (kind === 'vector') value = shared.types.szArray(constructed);
  if (kind === 'array') value = shared.types.array(constructed, 2);
  if (kind === 'pointer') value = shared.types.pointer(constructed);
  if (kind === 'byref') value = shared.types.byRef(constructed);
  if (kind === 'function-pointer') value = shared.types.functionPointer({ returnType: constructed, parameters: [argument] });
  if (kind === 'nested-tuple') value = await shared.types.instantiate(shared.definitions.pair, [constructed, argument]);
  assert.equal(value.isCollectible, true);
  assert.equal(value.containsGenericParameters, false);
  assert.equal(constructed.loadContext, definition.loadContext);
  const observed = [{ name: 'construction', reference: new WeakRef(value) }];
  if (definitionOwner) {
    observed.push({ name: 'definition-context', reference: new WeakRef(definitionOwner.context) });
    definitionOwner.context.unload();
  }
  if (argumentOwner) {
    observed.push({ name: 'argument-context', reference: new WeakRef(argumentOwner.context) });
    argumentOwner.context.unload();
  }
  return { value, observed };
}

async function observeCase(shared, kind) {
  const state = await createCase(shared, kind);
  await nextTurn();
  globalThis.gc();
  for (const entry of state.observed) assert.ok(entry.reference.deref(), `${kind}: retained construction owns ${entry.name}`);
  const retained = true;
  state.value = null;
  let attempts = 0;
  for (; attempts < maximumAttempts; attempts++) {
    await nextTurn();
    globalThis.gc();
    if (state.observed.every(entry => entry.reference.deref() === undefined)) break;
  }
  const collected = state.observed.map(entry => ({ name: entry.name, collected: entry.reference.deref() === undefined }));
  assert.ok(collected.every(entry => entry.collected), `${kind}: a canonical cache must not retain a collectible context`);
  return { kind, retained, attempts: attempts + 1, collected };
}

assert.equal(typeof globalThis.gc, 'function', 'The isolated collector probe requires --expose-gc');
const shared = await openGenerics();
const stable = await shared.types.instantiate(shared.definitions.box, [shared.types.intrinsic('System.Int32')]);
const cases = [];
for (const kind of ['generic', 'vector', 'array', 'pointer', 'byref', 'function-pointer', 'nested-tuple',
  'collectible-definition', 'two-collectible-contexts']) {
  cases.push(await observeCase(shared, kind));
}
const retainedCollectible = await openGenerics({ isCollectible: true }, { name: 'RetainedCollectibleDefinition' });
cases.push(await observeCase(retainedCollectible, 'retained-collectible-definition'));
assert.equal(retainedCollectible.context.isUnloading, false, 'The defining context remains rooted while its foreign argument collects');
retainedCollectible.context.unload();
assert.equal(await shared.types.instantiate(shared.definitions.box, [shared.types.intrinsic('System.Int32')]), stable);
assert.equal(shared.module.methodBodyReadCount, 0);
console.log(JSON.stringify({ format: 'sharpforge.generic-instantiation-gc', version: 1, node: process.version,
  maximumAttempts, forcedGc: true, cases, sharedDefinitionRetained: true, ordinaryIdentityRetained: true }));
