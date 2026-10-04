import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { remoteClosure, openClosure } from './clr-generics-closure-fixtures.js';
import { genericFixture, generic, variable, deferred } from './clr-generics-instantiation-fixtures.js';

const fails = code => error => error.code === code;

async function pendingArgument({ invalidDependency = false, ...options } = {}) {
  const argumentImage = remoteClosure('ClosureArgument', 'ClosureDependency', { delay: true });
  const started = deferred();
  const delivery = deferred();
  const dependency = genericFixture({ name: 'ClosureDependency', decorate({ base, tokens }) {
    if (invalidDependency) base(tokens.box, generic(tokens.node, [variable()]), 'invalidDependency');
  } });
  let calls = 0;
  const argumentContext = arrayContext({ ...options, load(request) {
    if (request.assemblyName.name !== 'ClosureDependency') return null;
    assert.equal(request.signal, undefined);
    calls++;
    started.resolve();
    return delivery.promise;
  } });
  const module = (await argumentContext.loadFromStream(argumentImage.image)).manifestModule;
  const host = arrayContext().types;
  const box = host.defineIntrinsic('Host.Box`1', { genericArity: 1 });
  return { host, box, argumentContext, module, argument: module.typeDefinition(argumentImage.tokens.subject),
    started: started.promise, release: () => delivery.resolve(dependency.image), get calls() { return calls; } };
}

test('CLR closure-only argument binding is independently cancellable and retries all unpublished proof obligations', { timeout: 5000 }, async () => {
  const state = await pendingArgument();
  const controller = new AbortController();
  const first = state.host.instantiate(state.box, [state.argument], { signal: controller.signal });
  const second = state.host.instantiate(state.box, [state.argument]);
  const rejected = assert.rejects(first, fails(LoadErrorCode.Cancelled));
  await state.started;
  controller.abort();
  await rejected;
  assert.equal(state.argument.isLoaded, false);
  state.release();
  const result = await second;
  assert.equal(await state.host.instantiate(state.box, [state.argument]), result);
  assert.equal(result.genericArguments[0], state.argument);
  assert.equal(state.calls, 1);
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR cancelled closure proofs cannot qualify an invalid argument on retry', { timeout: 5000 }, async () => {
  const state = await pendingArgument({ invalidDependency: true });
  const controller = new AbortController();
  const first = state.host.instantiate(state.box, [state.argument], { signal: controller.signal });
  const rejected = assert.rejects(first, fails(LoadErrorCode.Cancelled));
  await state.started;
  controller.abort();
  await rejected;
  const retry = state.host.instantiate(state.box, [state.argument]);
  const invalid = assert.rejects(retry, fails(LoadErrorCode.TypeLoad));
  state.release();
  await invalid;
  await assert.rejects(state.host.instantiate(state.box, [state.argument]), fails(LoadErrorCode.TypeLoad));
  assert.equal(state.argument.isLoaded, false);
  assert.equal(state.calls, 1);
});

test('CLR closure-only foreign contexts are monitored through throwing unload callbacks and cleaned on failure', async () => {
  const state = await pendingArgument({ isCollectible: true });
  const failure = new Error('Host unload listener failed');
  const remove = state.argumentContext.onUnloading(() => { throw failure; });
  const pending = state.host.instantiate(state.box, [state.argument]);
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await state.started;
  assert.throws(() => state.argumentContext.unload(), error => error === failure);
  state.release();
  await rejected;
  remove();
  assert.equal(state.argument.isLoaded, false);
  const retained = await state.host.instantiate(state.box, [state.argument]);
  assert.equal(retained.isCollectible, true);
  assert.equal(retained.genericArguments[0], state.argument);
  assert.equal(state.calls, 1);
});

test('CLR reentrant host resolution cannot admit a partially read expanding graph', async () => {
  let reentered = false;
  let types;
  let partner;
  let nested;
  const state = await openClosure('array-expanding', { typeOptions: {
    async resolveExternalType(request) {
      if (!reentered && partner) {
        reentered = true;
        nested = await request.resolveType(request.module, partner.metadataToken);
      }
      return types.intrinsic(`${request.namespace}.${request.name}`);
    },
  } });
  types = state.types;
  partner = state.definitions.contract;
  await assert.rejects(types.load(state.module, state.definitions.subject.metadataToken), fails(LoadErrorCode.TypeLoad));
  assert.equal(reentered, true);
  assert.equal(nested, partner);
  assert.equal(partner.isLoaded, true, 'The explicitly requested, independently valid nested graph remains completed');
  assert.equal(state.definitions.subject.isLoaded, false);
  await assert.rejects(types.instantiate(state.definitions.subject, [types.intrinsic('System.Int32'), types.intrinsic('System.String')]),
    fails(LoadErrorCode.TypeLoad));
  assert.equal(state.module.methodBodyReadCount, 0);
});
