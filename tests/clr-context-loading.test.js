import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, AssemblyProvider, AssemblyResolver, LoadErrorCode } from '../packages/clr/src/index.js';
import { contextFixture } from './clr-context-fixtures.js';

test('CLR default and custom contexts isolate equal simple names and type handles', async () => {
  const session = new AssemblyLoadSession();
  const first = session.createContext({ name: 'First' });
  const second = session.createContext({ name: 'Second' });
  const one = await first.loadFromStream(contextFixture('Plugin'));
  const two = await second.loadFromStream(contextFixture('Plugin', { version: [2, 0, 0, 0] }));
  assert.equal(session.defaultContext.name, 'Default');
  assert.deepEqual(one.identity.version, [1, 0, 0, 0]);
  assert.deepEqual(two.identity.version, [2, 0, 0, 0]);
  assert.notEqual(one.manifestModule.typeIdentity(0x02000002), two.manifestModule.typeIdentity(0x02000002));
  assert.equal(one.manifestModule.typeIdentity(0x02000002), one.manifestModule.typeIdentity(0x02000002));
  assert.equal((await first.loadFromAssemblyName('Plugin')), one);
  await assert.rejects(first.loadFromStream(contextFixture('Plugin', { version: [2, 0, 0, 0] })),
    error => error.code === LoadErrorCode.IdentityMismatch);
  assert.equal(session.getAssemblies().length, 2);
  assert.throws(() => new AssemblyLoadSession({ maxContexts: 1 }).createContext(), error => error.code === LoadErrorCode.LimitExceeded);
});

test('CLR Load override, Resolving and explicit providers receive the requesting assembly', async () => {
  const session = new AssemblyLoadSession();
  let calls = 0;
  const custom = session.createContext({ load: ({ assemblyName }) => {
    calls++;
    return assemblyName.name === 'Override' ? contextFixture('Override') : null;
  } });
  const requester = await custom.loadFromAssemblyName('Override');
  const requests = [];
  const dispose = custom.onResolving(request => {
    requests.push(request);
    return request.assemblyName.name === 'Resolved' ? contextFixture('Resolved') : null;
  });
  await custom.loadFromAssemblyName('Resolved', { requester });
  assert.equal(requests[0].requester, requester);
  assert.deepEqual(custom.loadOrder.map(name => name.split(',')[0]), ['Override', 'Resolved']);
  assert.equal(calls, 2);
  dispose();
  await assert.rejects(custom.loadFromAssemblyName('Missing'), error => error.code === LoadErrorCode.MissingAssembly);
  const providerContext = session.createContext({ resolver: new AssemblyResolver({ providers: [
    new AssemblyProvider('memory', [{ identity: 'Provided, Version=1.0.0.0', bytes: contextFixture('Provided') }]),
  ] }) });
  assert.equal((await providerContext.loadFromAssemblyName('Provided')).identity.name, 'Provided');
});

test('CLR invalid images, mismatched resolver output, reentrancy, limits and cancellation fail explicitly', async () => {
  const session = new AssemblyLoadSession();
  const context = session.createContext({ maxAssemblies: 1 });
  await assert.rejects(context.loadFromStream(Uint8Array.of(0, 1)), error => error.code === LoadErrorCode.InvalidImage);
  await assert.rejects(context.loadFromStream(contextFixture('Cancelled'), { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
  await context.loadFromStream(contextFixture('One'));
  await assert.rejects(context.loadFromStream(contextFixture('Two')), error => error.code === LoadErrorCode.LimitExceeded);
  const wrong = session.createContext({ load: () => contextFixture('Wrong') });
  await assert.rejects(wrong.loadFromAssemblyName('Expected'), error => error.code === LoadErrorCode.IdentityMismatch);
  assert.equal(wrong.assemblies.length, 0);
  const recursive = session.createContext();
  recursive.onResolving(request => recursive.loadFromAssemblyName(request.assemblyName));
  await assert.rejects(recursive.loadFromAssemblyName('Cycle'), error => error.code === LoadErrorCode.RecursiveResolution);
});

test('CLR 50-assembly load keeps method bodies lazy and caches each requested body', async () => {
  const context = new AssemblyLoadSession().defaultContext;
  const assemblies = [];
  for (let index = 0; index < 50; index++) assemblies.push(await context.loadFromStream(contextFixture(`Library${index}`)));
  assert.equal(assemblies.reduce((total, assembly) => total + assembly.manifestModule.methodBodyReadCount, 0), 0);
  const module = assemblies[0].manifestModule;
  assert.equal(module.scopeName, 'Library0.dll');
  const first = module.methodBody(0x06000001);
  first.code.fill(0);
  assert.ok(module.methodBody(0x06000001).code.some(byte => byte !== 0));
  assert.equal(module.methodBodyReadCount, 1);
  assert.equal(module.rowCount(6), 1);
  assert.match(module.moduleVersionId, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
  assert.throws(() => module.typeIdentity(0x06000001), error => error.code === LoadErrorCode.InvalidImage);
});

test('CLR independent same-name requests share an awaited resolving callback', async () => {
  const context = new AssemblyLoadSession().defaultContext;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  context.onResolving(async () => {
    calls++;
    entered();
    await gate;
    return contextFixture('Concurrent');
  });
  const first = context.loadFromAssemblyName('Concurrent');
  await started;
  const second = context.loadFromAssemblyName('Concurrent');
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one, two);
  assert.equal(calls, 1);
});

test('CLR scoped async callback resolution rejects a dependency cycle after await', async () => {
  const context = new AssemblyLoadSession().defaultContext;
  context.onResolving(async request => {
    await Promise.resolve();
    return request.resolveAssembly(request.assemblyName.name === 'First' ? 'Second' : 'First');
  });
  await assert.rejects(context.loadFromAssemblyName('First'), error => error.code === LoadErrorCode.RecursiveResolution);
});
