import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, LoadErrorCode, RuntimeAppDomain, RuntimeAppContext } from '../packages/clr/src/index.js';
import { contextFixture } from './clr-context-fixtures.js';

test('CLR collectible unload delivers once, rejects new work and retains live metadata roots', async () => {
  const session = new AssemblyLoadSession();
  const context = session.createContext({ name: 'Plugin', isCollectible: true });
  const assembly = await context.loadFromStream(contextFixture('Plugin'));
  const instance = { type: assembly.manifestModule.typeIdentity(0x02000002) };
  const root = context.roots.add(instance, { kind: 'instance' });
  let events = 0;
  context.onUnloading(() => events++);
  context.unload();
  context.unload();
  assert.equal(events, 1);
  assert.equal(context.roots.enumerate()[0].target, instance);
  assert.equal(instance.type.module.assembly.loadContext, context);
  assert.equal(assembly.manifestModule.methodBody(0x06000001).code.length > 0, true);
  await assert.rejects(context.loadFromAssemblyName('Other'), error => error.code === LoadErrorCode.Disposed);
  assert.throws(() => context.roots.add({}), error => error.code === LoadErrorCode.Disposed);
  assert.equal(session.contexts.includes(context), false);
  root.release();
  root.release();
  assert.equal(context.roots.strongCount, 0);
  assert.equal(root.context, null);
  assert.throws(() => session.defaultContext.unload(), error => error.code === LoadErrorCode.InvalidConfiguration);
});

test('CLR host WeakReference observes collectible context release after the last live instance', async context => {
  if (typeof globalThis.gc !== 'function') {
    context.skip('Requires node --expose-gc; this availability skip does not qualify collector behavior');
    return;
  }
  const session = new AssemblyLoadSession();
  async function createInstance() {
    const loadContext = session.createContext({ isCollectible: true });
    const assembly = await loadContext.loadFromStream(contextFixture('Collectible'));
    const weak = new WeakRef(loadContext);
    const instance = { type: assembly.manifestModule.typeIdentity(0x02000002) };
    loadContext.unload();
    return { weak, instance };
  }
  const state = await createInstance();
  await new Promise(resolve => setImmediate(resolve));
  globalThis.gc();
  assert.ok(state.weak.deref(), 'Live instance must keep context alive');
  state.instance = null;
  let collected = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    globalThis.gc();
    if (!state.weak.deref()) { collected = true; break; }
  }
  assert.equal(collected, true, 'Context should collect after last instance releases its type handle');
});
