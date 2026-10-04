import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession, TypeDesc, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-contexts/native-contexts.json', import.meta.url)));

test('CLR metadata type descriptors preserve canonical identity within their defining context', async () => {
  const session = new AssemblyLoadSession();
  const bytes = Buffer.from(native.images[0], 'base64');
  const first = session.createContext({ isCollectible: true });
  const second = session.createContext();
  const one = (await first.loadFromStream(bytes)).manifestModule;
  const two = (await second.loadFromStream(bytes)).manifestModule;
  const type = one.typeDefinition(0x02000002);
  assert.ok(type instanceof TypeDesc);
  assert.equal(type, one.typeDefinition(0x02000002));
  assert.notEqual(type, two.typeDefinition(0x02000002));
  assert.equal(type.name, 'Widget');
  assert.equal(type.namespace, '');
  assert.equal(type.fullName, 'Widget');
  assert.equal(type.metadataToken, 0x02000002);
  assert.equal(type.module, one);
  assert.equal(type.assembly, one.assembly);
  assert.equal(type.loadContext, first);
  assert.equal(type.declaringType, null);
  assert.equal(type.isInterface, false);
  assert.equal(String(type), 'Widget');
  assert.ok(Object.isFrozen(type));
  assert.throws(() => { type.name = 'Changed'; }, TypeError);
  assert.throws(() => new TypeDesc({}), /created by their runtime module/);
  assert.equal(one.methodBodyReadCount, 0);
  first.unload();
  assert.equal(type, one.typeDefinition(0x02000002));
  assert.equal(type.fullName, 'Widget');
});

test('CLR nested metadata names inherit their enclosing namespace and interface flags remain inspectable', async () => {
  const bytes = managedFixture({ name: 'NestedTypes', methods: [], decorate({ md }) {
    md.add(2, [0x22, md.string('INested'), 0, 0, 1, 1]);
    md.add(41, [3, 2]);
  } });
  const module = (await new AssemblyLoadSession().defaultContext.loadFromStream(bytes)).manifestModule;
  const nested = module.typeDefinition(0x02000003);
  assert.equal(nested.fullName, 'Fixture.Program+INested');
  assert.equal(nested.namespace, 'Fixture');
  assert.equal(nested.declaringType, module.typeDefinition(0x02000002));
  assert.equal(nested.isInterface, true);
  assert.equal(nested.flags, 0x22);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR type metadata rejects invalid tokens, nested cycles, duplicate owners and excessive names', async () => {
  const context = new AssemblyLoadSession().defaultContext;
  const regular = (await context.loadFromStream(managedFixture())).manifestModule;
  for (const token of [0, 0x02000000, 0x020000ff, 0x06000001, 0x02000002 + 0.5, 0x102000002]) {
    assert.throws(() => regular.typeDefinition(token), error => error.code === LoadErrorCode.InvalidImage);
  }
  for (const [name, decorate, code] of [
    ['Cycle', ({ md }) => md.add(41, [2, 2]), LoadErrorCode.TypeLoad],
    ['Duplicate', ({ md }) => { md.add(41, [2, 1]); md.add(41, [2, 1]); }, LoadErrorCode.TypeLoad],
    ['LongName', ({ md }) => { md.rows[2][1][1] = md.string('a'.repeat(4097)); }, LoadErrorCode.LimitExceeded],
  ]) {
    const module = (await context.loadFromStream(managedFixture({ name, decorate }))).manifestModule;
    assert.throws(() => module.typeDefinition(0x02000002), error => error.code === code);
  }
});

test('CLR nested metadata identity has an explicit depth limit', async () => {
  const bytes = managedFixture({ name: 'DeepNesting', methods: [], decorate({ md }) {
    for (let rid = 3; rid <= 130; rid++) {
      md.add(2, [2, md.string(`N${rid}`), 0, 0, 1, 1]);
      md.add(41, [rid, rid - 1]);
    }
  } });
  const module = (await new AssemblyLoadSession().defaultContext.loadFromStream(bytes)).manifestModule;
  assert.throws(() => module.typeDefinition(0x02000000 + 130), error => error.code === LoadErrorCode.LimitExceeded);
});
