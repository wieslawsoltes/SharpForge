import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { DefinitionBindings, definitionBindings } from '../packages/clr/src/generics/definition-bindings.js';
import { InstantiationClosures } from '../packages/clr/src/generics/instantiation-closure.js';
import { GenericResolutionContext } from '../packages/clr/src/generics/resolution-context.js';
import { awaitContextBinding } from '../packages/clr/src/binding-wait.js';
import { openGenerics, deferred } from './clr-generics-instantiation-fixtures.js';

const fails = code => error => error.code === code;

async function pendingProof() {
  const state = await openGenerics();
  const target = state.definitions.box;
  const dependency = state.definitions.other;
  const authority = new DefinitionBindings(1);
  const controller = new AbortController();
  const started = deferred();
  const provider = deferred();
  const expected = definitionBindings(dependency, []);
  const service = new InstantiationClosures(type => {
    if (type === target) return expected;
    assert.equal(type, dependency);
    started.resolve();
    return awaitContextBinding(provider.promise, controller.signal);
  }, { maxEntries: 100, maxDepth: 16 }, (type, binding, work) => authority.observe(type, binding, work));
  const work = new GenericResolutionContext(1000, controller.signal, () => { throw new Error('Unexpected collectible monitor'); });
  const pending = work.closure(service).require(target, {}).finally(() => work.dispose());
  return { ...state, target, authority, controller, work, pending, expected, started: started.promise,
    release: () => provider.resolve(definitionBindings(null, [])) };
}

test('CLR definition subscriptions have a finite per-definition cap and cancellation releases it before provider settlement', async () => {
  const state = await pendingProof();
  const rejected = assert.rejects(state.pending, fails(LoadErrorCode.Cancelled));
  await state.started;
  const probe = new GenericResolutionContext(1000, undefined, () => { throw new Error('Unexpected monitor'); });
  assert.throws(() => state.authority.observe(state.target, state.expected, probe), fails(LoadErrorCode.LimitExceeded));
  state.controller.abort();
  await rejected;
  const replacement = state.authority.observe(state.target, state.expected, probe);
  replacement.release();
  replacement.release();
  const again = state.authority.observe(state.target, state.expected, probe);
  again.release();
  probe.dispose();
  state.release();
});

test('CLR normal unload invalidation releases definition subscriptions while an external provider remains unresolved', async () => {
  const state = await pendingProof();
  const rejected = assert.rejects(state.pending, fails(LoadErrorCode.Disposed));
  await state.started;
  state.work.invalidate();
  const probe = new GenericResolutionContext(1000, undefined, () => { throw new Error('Unexpected monitor'); });
  const replacement = state.authority.observe(state.target, state.expected, probe);
  replacement.release();
  probe.dispose();
  state.release();
  await rejected;
});

test('CLR canonical direct-binding publication invalidates live conflicting consumers synchronously', async () => {
  const { definitions, types } = await openGenerics();
  const authority = new DefinitionBindings(2);
  const first = new GenericResolutionContext(1000, undefined, () => {});
  const second = new GenericResolutionContext(1000, undefined, () => {});
  const object = types.intrinsic('System.Object');
  const correct = definitionBindings(object, []);
  const wrong = definitionBindings(null, []);
  const matching = authority.observe(definitions.box, correct, first);
  const conflicting = authority.observe(definitions.box, wrong, second);
  authority.publish(definitions.box, { baseType: object, interfaces: Object.freeze([]), loaded: true }, correct);
  assert.equal(authority.get(definitions.box), correct);
  assert.equal(definitions.box.isLoaded, true);
  assert.doesNotThrow(() => first.complete());
  assert.throws(() => second.complete(), fails(LoadErrorCode.TypeLoad));
  matching.release();
  conflicting.release();
  first.dispose();
  second.dispose();
});
