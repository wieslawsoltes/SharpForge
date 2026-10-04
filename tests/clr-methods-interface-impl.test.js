import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { MethodBaseDefinitions } from '../packages/clr/src/type-system/method-base-definition.js';
import { interfaceContext, interfaceImplFixture } from './clr-methods-interface-impl-fixtures.js';

const load = async (image = interfaceImplFixture(), context = interfaceContext()) => (await context.loadFromStream(image)).manifestModule;
const code = expected => error => error.code === expected;

test('CLR interface-only MethodImpl rows preserve implicit class roots and explicit interface body identity', async () => {
  for (const memberRef of [false, true]) {
    const module = await load(interfaceImplFixture({ memberRef }));
    const leaf = module.methodDefinition(0x06000007);
    assert.equal(await leaf.getBaseDefinition(), module.methodDefinition(0x06000001));
    assert.equal(await leaf.getBaseDefinition(), module.methodDefinition(0x06000001));
    const explicit = module.methodDefinition(0x06000006);
    assert.equal(await explicit.getBaseDefinition(), explicit);
    assert.equal(module.methodBodyReadCount, 0);
  }
});

test('CLR MemberRef interface declarations resolve assembly-scoped TypeRefs through host policy', async () => {
  const image = interfaceImplFixture({ memberRef: true, decorate({ md, reference }) {
    md.rows[10][(reference & 0xffffff) - 1][0] = codedIndex('MemberRefParent', md.typeRef('System.IDisposable'));
    md.rows[10][(reference & 0xffffff) - 1][2] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: { kind: 'primitive', name: 'void' }, parameters: [] }));
  } });
  const module = await load(image);
  // This API classifies declaration scope; it does not certify interface method/body signature compatibility.
  assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
});

test('CLR interface classification never hides class mappings or unsupported declaration/body parents', async () => {
  const cases = [
    ({ md }) => md.add(25, [3, 12, 2]),
    ({ md, reference }) => { md.rows[25][0][1] = codedIndex('MethodDefOrRef', reference); },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][0] = codedIndex('MemberRefParent', 0x06000001); },
    ({ md, reference }) => {
      const spec = md.add(27, [md.blob(Uint8Array.of(0x12, 20))]);
      md.rows[10][(reference & 0xffffff) - 1][0] = codedIndex('MemberRefParent', spec);
    },
  ];
  for (const decorate of cases) {
    const module = await load(interfaceImplFixture({ memberRef: true, decorate }));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), code(LoadErrorCode.TypeLoad));
  }
});

test('CLR malformed MethodImpl owners, body ownership, duplicate declarations and signature tokens fail explicitly', async () => {
  const cases = [
    ({ md }) => { md.rows[25][0][0] = 0; },
    ({ md }) => { md.rows[25][0][1] = 2; },
    ({ md }) => { md.rows[25][0][1] = 0; },
    ({ md }) => { md.rows[25][0][2] = 200; },
    ({ md }) => { md.rows[25].push([...md.rows[25][0]]); },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][0] = 15; },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][0] = 0; },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][2] = md.blob(Uint8Array.of(6, 8)); },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][2] = md.blob(Uint8Array.of(0xff)); },
    ({ md, reference }) => { md.rows[10][(reference & 0xffffff) - 1][2] = 9999; },
  ];
  for (const decorate of cases) {
    const module = await load(interfaceImplFixture({ memberRef: true, decorate }));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), code(LoadErrorCode.InvalidImage));
  }
});

test('CLR MethodImpl classification bounds ownership and declaration signature allocation', async () => {
  const module = await load();
  const methods = new MethodBaseDefinitions(module.assembly.loadContext.types, { maxDepth: 128, maxMetadataRows: 14 });
  await assert.rejects(methods.get(module.methodDefinition(0x06000007)), code(LoadErrorCode.LimitExceeded));
  const oversized = await load(interfaceImplFixture({ memberRef: true, decorate({ md, reference }) {
    md.rows[10][(reference & 0xffffff) - 1][2] = md.blob(new Uint8Array(4097));
  } }));
  await assert.rejects(oversized.methodDefinition(0x06000007).getBaseDefinition(), code(LoadErrorCode.LimitExceeded));
  const budget = await load(interfaceImplFixture({ memberRef: true, decorate({ md, contract }) {
    md.rows[25] = [];
    const signature = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: { kind: 'primitive', name: 'void' }, parameters: Array(2048).fill({ kind: 'primitive', name: 'int' }) }));
    for (let index = 0; index < 64; index++) {
      const reference = md.add(10, [codedIndex('MemberRefParent', contract), md.string('Other'), signature]);
      md.add(25, [3, 12, codedIndex('MethodDefOrRef', reference)]);
    }
  } }));
  await assert.rejects(budget.methodDefinition(0x06000007).getBaseDefinition(), code(LoadErrorCode.LimitExceeded));
});

test('CLR cancelled asynchronous interface classification can retry and cached roots survive unload', async () => {
  const controller = new AbortController();
  let context;
  let cancel = true;
  context = interfaceContext({ isCollectible: true, typeOptions: { async resolveExternalType({ namespace, name }) {
    await Promise.resolve();
    if (name === 'IDisposable' && cancel) controller.abort();
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  const image = interfaceImplFixture({ memberRef: true, decorate({ md, reference }) {
    md.rows[10][(reference & 0xffffff) - 1][0] = codedIndex('MemberRefParent', md.typeRef('System.IDisposable'));
  } });
  const module = await load(image, context);
  const method = module.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: controller.signal }), code(LoadErrorCode.Cancelled));
  cancel = false;
  const root = await method.getBaseDefinition();
  assert.equal(root, module.methodDefinition(0x06000001));
  context.unload();
  assert.equal(await method.getBaseDefinition(), root);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), code(LoadErrorCode.Cancelled));
});
