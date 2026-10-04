import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { genericFixture, remoteGenericFixture, deferred, openGenerics, generic, variable } from './clr-generics-instantiation-fixtures.js';

const fails = code => error => error.code === code;

async function delayedContext(options = {}) {
  const fixture = remoteGenericFixture();
  const dependency = genericFixture({ name: 'Dependency' }).image;
  const started = deferred();
  const bytes = deferred();
  let calls = 0;
  const context = arrayContext({ ...options, load(request) {
    if (request.assemblyName.name !== 'Dependency') return null;
    assert.equal(request.signal, undefined, 'The context-owned bind does not inherit a generic consumer signal');
    calls++;
    started.resolve();
    return bytes.promise;
  } });
  const module = (await context.loadFromStream(fixture.image)).manifestModule;
  return { ...fixture, context, module, types: context.types, definition: module.typeDefinition(fixture.tokens.box),
    started: started.promise, release: () => bytes.resolve(dependency), fail: bytes.reject, get calls() { return calls; } };
}

async function delayedExternalContext() {
  const fixture = genericFixture();
  const started = deferred();
  const external = deferred();
  let types;
  const context = arrayContext({ isCollectible: true, typeOptions: {
    resolveExternalType({ assemblyName, namespace, name, signal }) {
      assert.equal(assemblyName.name, 'System.Runtime');
      assert.equal(`${namespace}.${name}`, 'System.Object');
      started.resolve(signal);
      return external.promise;
    },
  } });
  types = context.types;
  const module = (await context.loadFromStream(fixture.image)).manifestModule;
  return { context, types, module, definition: module.typeDefinition(fixture.tokens.box), started: started.promise,
    release: () => external.resolve(types.intrinsic('System.Object')), fail: external.reject };
}

test('CLR cancelling one generic consumer promptly preserves a concurrent consumer and the shared binding', { timeout: 5000 }, async () => {
  const state = await delayedContext();
  const integer = state.types.intrinsic('System.Int32');
  const controller = new AbortController();
  const first = state.types.instantiate(state.definition, [integer], { signal: controller.signal });
  const second = state.types.instantiate(state.definition, [integer]);
  const rejected = assert.rejects(first, fails(LoadErrorCode.Cancelled));
  await state.started;
  controller.abort();
  await rejected;
  assert.equal(state.definition.isLoaded, false);
  state.release();
  const result = await second;
  assert.equal(state.calls, 1);
  assert.equal(result.isLoaded, true);
  assert.equal(result, await state.types.instantiate(state.definition, [integer]));
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR generic operation arrays are snapshotted before asynchronous binding', async () => {
  const state = await delayedContext();
  const integer = state.types.intrinsic('System.Int32');
  const text = state.types.intrinsic('System.String');
  const arguments_ = [integer];
  const pending = state.types.instantiate(state.definition, arguments_);
  await state.started;
  arguments_[0] = text;
  state.release();
  assert.deepEqual((await pending).genericArguments, [integer]);
  const scoped = await delayedContext();
  const typeArguments = [scoped.types.intrinsic('System.Int32')];
  const methodArguments = [scoped.types.intrinsic('System.String')];
  const expected = [typeArguments[0], methodArguments[0]];
  const resolved = scoped.types.load(scoped.module, scoped.specs.remotePair, { typeArguments, methodArguments });
  await scoped.started;
  [typeArguments[0], methodArguments[0]] = [methodArguments[0], typeArguments[0]];
  scoped.release();
  assert.deepEqual((await resolved).genericArguments, expected);
});

test('CLR generic binding listeners are removed after success, failure and cancellation', async () => {
  for (const outcome of ['success', 'failure', 'cancel']) {
    const state = await delayedContext();
    const controller = new AbortController();
    let listeners = 0;
    const signal = {
      get aborted() { return controller.signal.aborted; },
      addEventListener(name, callback, options) { listeners++; controller.signal.addEventListener(name, callback, options); },
      removeEventListener(name, callback) { listeners--; controller.signal.removeEventListener(name, callback); },
    };
    const pending = state.types.instantiate(state.definition, [state.types.intrinsic('System.Int32')], { signal });
    const expectedError = outcome === 'cancel' ? LoadErrorCode.Cancelled : LoadErrorCode.InvalidImage;
    const result = outcome === 'success' ? pending : assert.rejects(pending, fails(expectedError));
    await state.started;
    assert.equal(listeners, 1);
    if (outcome === 'cancel') controller.abort();
    else if (outcome === 'failure') state.fail(new Error('Host binding failure'));
    else state.release();
    await result;
    assert.equal(listeners, 0);
    if (outcome === 'cancel') {
      state.fail(new Error('Late observed binding failure'));
      await new Promise(resolve => setImmediate(resolve));
    }
  }
});

test('CLR generic completion rejects context unload transitions and retains previously completed metadata identities', async () => {
  const state = await delayedContext({ isCollectible: true });
  const pending = state.types.instantiate(state.definition, [state.types.intrinsic('System.Int32')]);
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await state.started;
  state.context.unload();
  state.release();
  await rejected;
  assert.equal(state.definition.isLoaded, false);
  const retained = await openGenerics({ isCollectible: true });
  const integer = retained.types.intrinsic('System.Int32');
  const type = await retained.types.instantiate(retained.definitions.box, [integer]);
  retained.context.unload();
  assert.equal(type.isCollectible, true);
  assert.equal(type, await retained.types.instantiate(retained.definitions.box, [integer]));
  const next = await retained.types.instantiate(retained.definitions.box, [retained.types.intrinsic('System.String')]);
  assert.equal(next.isLoaded, true, 'Already loaded definition metadata remains usable while the context is retained');
});

test('CLR a collectible argument context unload cannot publish a stale completion in a shared definition context', async () => {
  const state = await delayedContext();
  const argumentOwner = await openGenerics({ isCollectible: true }, { name: 'Arguments' });
  const argument = await argumentOwner.types.load(argumentOwner.module, 0x02000002);
  const pending = state.types.instantiate(state.definition, [argument]);
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await state.started;
  argumentOwner.context.unload();
  state.release();
  await rejected;
  assert.equal(state.definition.isLoaded, false);
  const result = await state.types.instantiate(state.definition, [argument]);
  assert.equal(result.loadContext, state.context);
  assert.equal(result.genericArguments[0].loadContext, argumentOwner.context);
  assert.equal(result.isCollectible, true);
});

test('CLR already aborted generic operations do not create or publish constructions', async () => {
  const { types, definitions, module, specs } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const signal = AbortSignal.abort();
  await assert.rejects(types.instantiate(definitions.box, [integer], { signal }), fails(LoadErrorCode.Cancelled));
  await assert.rejects(types.load(module, specs.scopeType, { typeArguments: [integer], signal }), fails(LoadErrorCode.Cancelled));
  assert.equal(definitions.box.isLoaded, false);
});

test('CLR copied VAR and MVAR contexts are observed before an external generic definition bind', async () => {
  for (const scope of ['typeArguments', 'methodArguments']) {
    const state = await delayedContext();
    const foreign = await openGenerics({ isCollectible: true }, { name: 'ForeignArguments' });
    const options = {
      typeArguments: [state.types.intrinsic('System.Int32')],
      methodArguments: [state.types.intrinsic('System.String')],
    };
    options[scope] = [foreign.definitions.other];
    const pending = state.types.load(state.module, state.specs.remotePair, options);
    const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
    await state.started;
    foreign.context.unload();
    state.release();
    await rejected;
    const retained = await state.types.load(state.module, state.specs.remotePair, options);
    assert.equal(retained.genericArguments[scope === 'typeArguments' ? 0 : 1], foreign.definitions.other);
    assert.equal(retained.isCollectible, true);
    assert.equal(state.calls, 1);
    assert.equal(state.module.methodBodyReadCount, 0);
  }
});

test('CLR concurrent generic operations share one context subscription and release it at completion', { timeout: 15000 }, async () => {
  const state = await delayedContext({ isCollectible: true });
  const listeners = Array.from({ length: 1023 }, () => state.context.onUnloading(() => {}));
  const integer = state.types.intrinsic('System.Int32');
  const pending = Promise.all(Array.from({ length: 1030 }, () => state.types.instantiate(state.definition, [integer])));
  await state.started;
  assert.throws(() => state.context.onUnloading(() => {}), /listener limit/, 'Exactly one event slot observes every generic consumer');
  state.release();
  const results = await pending;
  assert.ok(results.every(type => type === results[0]));
  assert.equal(state.calls, 1);
  const availableAgain = state.context.onUnloading(() => {});
  availableAgain();
  for (const remove of listeners) remove();
  state.context.unload();
});

test('CLR context-owned generic lifetime subscribers have an explicit bound and cancelled consumers release capacity', async () => {
  const state = await delayedContext({ isCollectible: true, typeOptions: { maxGenericWork: 256 } });
  const integer = state.types.intrinsic('System.Int32');
  const controllers = Array.from({ length: 256 }, () => new AbortController());
  const pending = controllers.map(controller => state.types.instantiate(state.definition, [integer], { signal: controller.signal }));
  const cancelled = assert.rejects(pending[0], fails(LoadErrorCode.Cancelled));
  const continuing = Promise.all(pending.slice(1));
  const excess = assert.rejects(state.types.instantiate(state.definition, [integer]), fails(LoadErrorCode.LimitExceeded));
  await state.started;
  await excess;
  controllers[0].abort();
  await cancelled;
  const replacement = state.types.instantiate(state.definition, [integer]);
  state.release();
  const results = await continuing;
  assert.equal(await replacement, results[0]);
  assert.equal(state.calls, 1);
});

test('CLR reentrant unloading retains completed metadata while invalidating earlier pending generic work', async () => {
  const state = await delayedContext({ isCollectible: true });
  const other = state.module.typeDefinition(state.tokens.other);
  const integer = state.types.intrinsic('System.Int32');
  const retained = await state.types.instantiate(other, [integer]);
  let repeated;
  let created;
  state.context.onUnloading(() => {
    repeated = state.types.instantiate(other, [integer]);
    created = state.types.instantiate(other, [state.types.intrinsic('System.String')]);
  });
  const pending = state.types.instantiate(state.definition, [integer]);
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await state.started;
  state.context.unload();
  state.release();
  await rejected;
  assert.equal(await repeated, retained);
  assert.equal((await created).isLoaded, true);
  assert.equal(state.definition.isLoaded, false);
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR throwing unloading listeners cannot publish successful pending generic root operations', async () => {
  for (const operation of ['instantiate', 'load', 'find', 'arrayMember']) {
    const state = await delayedContext();
    const foreign = await openGenerics({ isCollectible: true }, { name: 'ForeignArguments' });
    const failure = new Error('User unloading callback failed');
    foreign.context.onUnloading(() => { throw failure; });
    const integer = state.types.intrinsic('System.Int32');
    const options = { typeArguments: [foreign.definitions.other], methodArguments: [integer] };
    const start = () => {
      if (operation === 'instantiate') return state.types.instantiate(state.definition, [foreign.definitions.other]);
      if (operation === 'load') return state.types.load(state.module, state.tokens.box, options);
      if (operation === 'find') return state.types.find(state.module, 'Fixture.Box`1', options);
      return state.types.resolveArrayMember(state.module, state.tokens.arrayGet, options);
    };
    const pending = start();
    const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
    await state.started;
    assert.throws(() => foreign.context.unload(), error => error === failure);
    state.release();
    await rejected;
    if (operation === 'load' || operation === 'find') assert.equal(state.definition.isLoaded, false);
    const retained = await start();
    assert.equal(operation === 'arrayMember' ? retained.declaringType.isLoaded : retained.isLoaded, true);
    assert.equal(state.calls, 1);
    assert.equal(state.module.methodBodyReadCount, 0);
  }
});

test('CLR failed foreign lifetime subscription releases earlier context subscriptions', async () => {
  const state = await delayedContext({ isCollectible: true });
  const foreign = await openGenerics({ isCollectible: true }, { name: 'ForeignArguments' });
  const ownListeners = Array.from({ length: 1023 }, () => state.context.onUnloading(() => {}));
  const foreignListeners = Array.from({ length: 1024 }, () => foreign.context.onUnloading(() => {}));
  await assert.rejects(state.types.instantiate(state.definition, [foreign.definitions.other]), fails(LoadErrorCode.LimitExceeded));
  assert.equal(state.calls, 0, 'Lifetime admission fails before an assembly bind');
  const releasedSlot = state.context.onUnloading(() => {});
  releasedSlot();
  for (const remove of [...ownListeners, ...foreignListeners]) remove();
  const pending = state.types.instantiate(state.definition, [foreign.definitions.other]);
  await state.started;
  state.release();
  assert.equal((await pending).isLoaded, true);
  foreign.context.unload();
  state.context.unload();
});

test('CLR cross-context find and array-member requests observe the module owner before binding', async () => {
  for (const operation of ['find', 'arrayMember']) {
    const state = await delayedContext({ isCollectible: true });
    const caller = await openGenerics();
    let typeReads = 0;
    let methodReads = 0;
    const options = {
      get typeArguments() { typeReads++; return [caller.types.intrinsic('System.Int32')]; },
      get methodArguments() { methodReads++; return [caller.types.intrinsic('System.String')]; },
    };
    const pending = operation === 'find'
      ? caller.types.find(state.module, 'Fixture.Box`1', options)
      : caller.types.resolveArrayMember(state.module, state.tokens.arrayGet, options);
    const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
    await state.started;
    state.context.unload();
    state.release();
    await rejected;
    assert.equal(typeReads, 1);
    assert.equal(methodReads, 1);
    assert.equal(state.definition.isLoaded, false);
  }
});

test('CLR ignored external-resolver cancellation rejects promptly and observes both late outcomes', { timeout: 5000 }, async () => {
  for (const outcome of ['fulfill', 'reject']) {
    const state = await delayedExternalContext();
    const listeners = Array.from({ length: 1023 }, () => state.context.onUnloading(() => {}));
    const controller = new AbortController();
    const pending = state.types.instantiate(state.definition, [state.types.intrinsic('System.Int32')], { signal: controller.signal });
    const rejected = assert.rejects(pending, fails(LoadErrorCode.Cancelled));
    assert.equal(await state.started, controller.signal, 'The external callback retains its existing caller signal argument');
    controller.abort();
    await rejected;
    assert.equal(state.definition.isLoaded, false);
    const releasedSlot = state.context.onUnloading(() => {});
    releasedSlot();
    if (outcome === 'fulfill') state.release();
    else state.fail(new Error('Late external resolver failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.definition.isLoaded, false, 'A late external callback cannot publish through the cancelled operation');
    for (const remove of listeners) remove();
    state.context.unload();
  }
});

test('CLR unloading during external generic type resolution prevents requested loaded-state publication', async () => {
  const state = await delayedExternalContext();
  const pending = state.types.instantiate(state.definition, [state.types.intrinsic('System.Int32')]);
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await state.started;
  state.context.unload();
  state.release();
  await rejected;
  assert.equal(state.definition.isLoaded, false);
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR a resolved foreign generic definition is observed before resolving later argument identities', async () => {
  const foreign = await openGenerics({ isCollectible: true }, { name: 'ForeignDefinitions' });
  const definition = await foreign.types.load(foreign.module, foreign.tokens.pair);
  const argument = await foreign.types.load(foreign.module, foreign.tokens.other);
  const started = deferred();
  const pendingArgument = deferred();
  let owner;
  owner = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      if (assemblyName.name === 'System.Runtime') return owner.types.intrinsic(`${namespace}.${name}`);
      assert.equal(assemblyName.name, 'ForeignDefinitions');
      if (name === 'Pair`2') return definition;
      assert.equal(name, 'Other`1');
      started.resolve();
      return pendingArgument.promise;
    },
  } }, { decorate({ md, specification }) {
    const pair = md.typeRef('Fixture.Pair`2', 'ForeignDefinitions');
    const other = md.typeRef('Fixture.Other`1', 'ForeignDefinitions');
    specification('externalGenerics', generic(pair, [{ kind: 'class', token: other }, variable()]));
  } });
  const pending = owner.types.load(owner.module, owner.specs.externalGenerics, {
    typeArguments: [owner.types.intrinsic('System.Int32')],
  });
  const rejected = assert.rejects(pending, fails(LoadErrorCode.Disposed));
  await started.promise;
  foreign.context.unload();
  pendingArgument.resolve(argument);
  await rejected;
  assert.equal(owner.module.methodBodyReadCount, 0);
});
