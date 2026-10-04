import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, MethodDesc, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';
import { MetadataMemberDefinitions as MetadataMethodDefinitions } from '../packages/clr/src/type-system/metadata-member-definitions.js';

const load = async image => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
const invalidImage = error => error.code === LoadErrorCode.InvalidImage;

test('CLR method identities are canonical and isolate lazy immutable signatures and method body bytes', async () => {
  const image = managedFixture();
  const module = await load(image);
  const method = module.methodDefinition(0x06000001);
  assert.ok(method instanceof MethodDesc);
  assert.throws(() => new MethodDesc({}), TypeError);
  assert.equal(method, module.methodDefinition(0x06000001));
  assert.equal(method, module.methodDefinitions(0x02000002)[0]);
  assert.equal(module.methodDefinitions(0x02000002), module.methodDefinitions(0x02000002));
  assert.ok(Object.isFrozen(module.methodDefinitions(0x02000002)));
  assert.deepEqual(module.methodDefinitions(0x02000001), []);
  assert.notEqual(method, (await load(image)).methodDefinition(0x06000001));
  assert.equal(method.declaringType, module.typeDefinition(0x02000002));
  assert.equal(method.module, module);
  assert.equal(method.assembly, module.assembly);
  assert.equal(method.loadContext, module.assembly.loadContext);
  assert.equal(method.name, 'Main');
  assert.equal(method.flags, 0x96);
  assert.equal(method.implementationFlags, 0);
  assert.equal(method.isStatic, true);
  assert.equal(module.methodBodyReadCount, 0);
  assert.equal(method.signature.returnType.name, 'int');
  assert.equal(method.signature, method.signature);
  assert.ok(Object.isFrozen(method.signature));
  assert.throws(() => { method.signature.parameters.push({ kind: 'primitive', name: 'int' }); }, TypeError);
  assert.equal(module.methodBodyReadCount, 0);
  const body = method.getMethodBody();
  const first = body.code[0];
  body.code[0] ^= 0xff;
  assert.equal(method.getMethodBody().code[0], first);
  assert.equal(module.methodBodyReadCount, 1);
});

test('CLR MethodPtr indirection preserves physical definition identity and declared list order', async () => {
  const image = managedFixture({ methods: [
    { name: 'First', result: 'void', body: writer => writer.op('ret') },
    { name: 'Second', result: 'void', body: writer => writer.op('ret') },
  ], decorate({ md }) {
    md.uncompressed = true;
    md.add(5, [2]);
    md.add(5, [1]);
    md.add(2, [1, md.string('Other'), md.string('Fixture'), 0, 1, 2]);
  } });
  const module = await load(image);
  assert.deepEqual(module.methodDefinitions(0x02000002).map(method => method.name), ['Second']);
  assert.deepEqual(module.methodDefinitions(0x02000003).map(method => method.name), ['First']);
  assert.equal(module.methodDefinition(0x06000002).declaringType, module.typeDefinition(0x02000002));
  assert.equal(module.methodDefinition(0x06000001).declaringType, module.typeDefinition(0x02000003));
});

test('CLR method identity rejects invalid tokens, ownership and bounded names', async () => {
  const module = await load(managedFixture());
  for (const token of [0, 0x06000000, 0x02000002, 0x06000002, 0x106000001, 6.5]) {
    assert.throws(() => module.methodDefinition(token), invalidImage);
  }
  assert.throws(() => module.methodDefinitions(0x06000001), invalidImage);
  const missing = await load(managedFixture({ decorate({ md }) {
    md.rows[2][0][5] = 2;
    md.rows[2][1][5] = 2;
  } }));
  assert.throws(() => missing.methodDefinition(0x06000001), /no declaring type/);
  const duplicate = await load(managedFixture({ decorate({ md }) {
    md.uncompressed = true;
    md.add(5, [1]);
    md.add(5, [1]);
  } }));
  assert.throws(() => duplicate.methodDefinitions(0x02000002), invalidImage);
  const longName = await load(managedFixture({ methods: [{ name: 'x'.repeat(4097), noBody: true }] }));
  assert.throws(() => longName.methodDefinition(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
});

test('CLR malformed signature diagnostics remain lazy and absent RVA bodies return null', async () => {
  for (const signature of [Uint8Array.of(0xff), Uint8Array.of(6, 8), Uint8Array.of(0x20, 0, 8)]) {
    const module = await load(managedFixture({ methods: [{ name: 'Invalid', signature, noBody: true }] }));
    const method = module.methodDefinition(0x06000001);
    assert.equal(method.name, 'Invalid');
    assert.equal(method.getMethodBody(), null);
    assert.throws(() => method.signature, invalidImage);
    assert.equal(module.methodBodyReadCount, 0);
  }
});

test('CLR method ownership index rejects oversized table counts before allocating ownership storage', () => {
  for (const table of [2, 5, 6]) {
    const definitions = new MetadataMethodDefinitions({
      row: () => [0, 0, 0x96, 0, 0, 1],
      rowCount: actual => actual === table ? 100001 : 0,
    });
    assert.throws(() => definitions.get(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
  }
});
