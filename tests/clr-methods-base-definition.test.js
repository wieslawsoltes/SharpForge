import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { MethodBaseDefinitions } from '../packages/clr/src/type-system/method-base-definition.js';
import { managedFixture } from './managed-fixtures.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';

const load = async (context, image = hierarchyFixture()) => (await context.loadFromStream(image)).manifestModule;
const typeLoad = error => error.code === LoadErrorCode.TypeLoad;

test('CLR class base definitions follow overloads, skipped ancestors and nearest new-slot boundaries without bodies', async () => {
  const context = baseContext();
  const module = await load(context);
  const expected = [1, 2, 3, 1, 5, 6, 1, 2, 5];
  for (let index = 0; index < expected.length; index++) {
    const method = module.methodDefinition(0x06000001 + index);
    const base = module.methodDefinition(0x06000000 + expected[index]);
    assert.equal(await method.getBaseDefinition(), base);
    assert.equal(await method.getBaseDefinition(), base);
  }
  assert.equal(await baseContext().types.getBaseDefinition(module.methodDefinition(0x06000007)), module.methodDefinition(0x06000001));
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR static, nonvirtual and interface base queries are identity operations without signatures or base loading', async () => {
  const context = new AssemblyLoadSession().createContext();
  const image = managedFixture({ methods: [
    { name: 'Static', flags: 0x16, signature: Uint8Array.of(0xff), noBody: true },
    { name: 'Instance', flags: 6, signature: Uint8Array.of(0xff), noBody: true },
    { name: 'Contract', flags: 0x5c6, signature: Uint8Array.of(0xff), noBody: true },
  ], decorate({ md }) { md.add(2, [0xa1, md.string('IContract'), 0, 0, 1, 3]); } });
  const module = await load(context, image);
  for (let row = 1; row <= 3; row++) {
    const method = module.methodDefinition(0x06000000 + row);
    assert.equal(await method.getBaseDefinition(), method);
  }
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR base matching resolves equivalent TypeDef/TypeRef signatures across assembly boundaries', async () => {
  const base = managedFixture({ name: 'OverrideBase', methods: [{ name: 'M', flags: 0x1c6, static: false, noBody: true }],
    decorate({ md }) { md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: { kind: 'class', token: 0x02000002 }, parameters: [] })); } });
  const derived = managedFixture({ name: 'OverrideDerived', methods: [{ name: 'M', flags: 0xc6, static: false, noBody: true }],
    decorate({ md }) {
      md.referenceIdentities.set('overridebase', { name: 'OverrideBase', version: [1, 0, 0, 0],
        culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
      const reference = md.typeRef('Fixture.Program', 'OverrideBase');
      md.rows[2][1][3] = codedIndex('TypeDefOrRef', reference);
      md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
        returnType: { kind: 'class', token: reference }, parameters: [] }));
    } });
  const context = baseContext({ load: ({ assemblyName }) => assemblyName.name === 'OverrideBase' ? base : null });
  const module = await load(context, derived);
  const root = await module.methodDefinition(0x06000001).getBaseDefinition();
  assert.equal(root.module.assembly.identity.name, 'OverrideBase');
  assert.equal(root, root.module.methodDefinition(0x06000001));
  assert.equal(root.module.methodBodyReadCount + module.methodBodyReadCount, 0);
});

test('CLR invalid and unsupported override families fail explicitly rather than inventing roots', async () => {
  const cases = [
    md => { md.rows[6][0][2] |= 0x20; },
    md => { md.rows[6][0][2] |= 0x200; },
    md => { md.rows[6][3][2] &= ~0x40; },
    md => { md.add(25, [2, 2, 2]); },
    md => { md.rows[6][6][3] = md.string('MissingIntrinsicSlot'); },
    md => { md.rows[2][1][3] = codedIndex('TypeDefOrRef', 0x02000004); },
    md => { md.rows[6][6][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: { kind: 'modopt', token: 0x02000002, element: { kind: 'primitive', name: 'int' } },
      parameters: [{ kind: 'primitive', name: 'int' }] })); },
  ];
  for (const decorate of cases) {
    const context = baseContext();
    const module = await load(context, hierarchyFixture(({ md }) => decorate(md)));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), typeLoad);
  }
  const malformed = await load(baseContext(), hierarchyFixture(({ md }) => md.add(25, [0, 2, 2])));
  await assert.rejects(malformed.methodDefinition(0x06000007).getBaseDefinition(), error => error.code === LoadErrorCode.InvalidImage);
  const ambiguous = await load(baseContext(), hierarchyFixture(({ md }) => { md.rows[6][2][3] = md.string('M'); }));
  await assert.rejects(ambiguous.methodDefinition(0x06000007).getBaseDefinition(), error => error.code === LoadErrorCode.InvalidImage);
});

test('CLR reuse-slot without any matching ancestor introduces itself when the metadata chain is complete', async () => {
  const context = baseContext();
  const module = await load(context, hierarchyFixture(({ md }) => {
    md.rows[2][1][3] = 0;
    md.rows[6][6][3] = md.string('IntroducedHere');
  }));
  const method = module.methodDefinition(0x06000007);
  assert.equal(await method.getBaseDefinition(), method);
});

test('CLR base queries bound metadata/candidates and preserve cancellation and cached identity through unload', async () => {
  const context = baseContext({ isCollectible: true });
  const module = await load(context);
  const method = module.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), error => error.code === LoadErrorCode.Cancelled);
  await context.types.load(module, method.declaringType.metadataToken);
  const bounded = new MethodBaseDefinitions(context.types, { maxDepth: 128, maxMetadataRows: 2 });
  await assert.rejects(bounded.get(method), error => error.code === LoadErrorCode.LimitExceeded);
  const shallow = new MethodBaseDefinitions(context.types, { maxDepth: 1, maxMetadataRows: 100 });
  await assert.rejects(shallow.get(method), error => error.code === LoadErrorCode.LimitExceeded);
  await assert.rejects(context.types.getBaseDefinition({}), TypeError);
  const root = await method.getBaseDefinition();
  context.unload();
  assert.equal(await method.getBaseDefinition(), root);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), error => error.code === LoadErrorCode.Cancelled);
  await assert.rejects(context.loadFromStream(hierarchyFixture()), error => error.code === LoadErrorCode.Disposed);
});
