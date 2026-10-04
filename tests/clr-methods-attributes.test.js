import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignature, readPE } from '@sharpforge/cil';
import { AssemblyLoadSession, RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const access = ['isPrivate', 'isFamilyAndAssembly', 'isAssembly', 'isFamily', 'isFamilyOrAssembly', 'isPublic'];
const bits = { isStatic: 0x10, isFinal: 0x20, isVirtual: 0x40, isHideBySig: 0x80, isAbstract: 0x400, isSpecialName: 0x800 };
const load = async image => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
const methods = flags => flags.map((value, index) => ({ name: 'M' + index, flags: value, signature: Uint8Array.of(0xff), noBody: true }));

test('CLR MethodBase access predicates decode mutually exclusive access masks without reading signatures', async () => {
  const module = await load(managedFixture({ methods: methods(Array.from({ length: 8 }, (_, value) => 0x890 | value)) }));
  for (let mask = 0; mask < 8; mask++) {
    const method = module.methodDefinition(0x06000001 + mask);
    for (let index = 0; index < access.length; index++) assert.equal(method[access[index]], mask === index + 1);
    assert.equal(method.flags, 0x890 | mask);
    assert.throws(() => method.callingConvention, error => error.code === LoadErrorCode.InvalidImage);
  }
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR method attribute predicates preserve independent bits and raw implementation flags', async () => {
  const flags = [0, ...Object.values(bits), 0xffff];
  const module = await load(managedFixture({ methods: methods(flags), decorate({ md }) { md.rows[6][0][1] = 0xffff; } }));
  for (let index = 0; index < flags.length; index++) {
    const method = module.methodDefinition(0x06000001 + index);
    for (const [name, bit] of Object.entries(bits)) assert.equal(method[name], Boolean(flags[index] & bit));
  }
  assert.equal(module.methodDefinition(0x06000001).implementationFlags, 0xffff);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR reflection calling conventions project decoded headers and reuse the lazy signature', () => {
  const headers = [
    { callingConvention: 0, expected: 1 }, { callingConvention: 5, expected: 2 },
    { hasThis: true, expected: 33 }, { callingConvention: 5, hasThis: true, expected: 34 },
    { hasThis: true, explicitThis: true, expected: 97 },
    { callingConvention: 5, hasThis: true, explicitThis: true, expected: 98 },
    { genericArity: 1, expected: 1 },
    ...[1, 2, 3, 4, 9, 11].map(callingConvention => ({ callingConvention, expected: 1 })),
  ];
  const image = managedFixture({ methods: headers.map(({ expected, ...header }, index) => ({
    name: 'M' + index, static: !header.hasThis, noBody: true,
    signature: encodeSignature({ kind: 'method', returnType: { kind: 'primitive', name: 'void' }, parameters: [], ...header }),
  })) });
  const pe = readPE(image, { inspection: true });
  const blob = pe.metadata.blob;
  let reads = 0;
  pe.metadata.blob = index => { reads++; return blob(index); };
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  for (let index = 0; index < headers.length; index++) {
    const method = module.methodDefinition(0x06000001 + index);
    assert.equal(reads, index);
    assert.equal(method.callingConvention, headers[index].expected);
    assert.equal(method.callingConvention, headers[index].expected);
    assert.equal(reads, index + 1);
  }
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR method convention keeps signature errors and heap bounds lazy and remains usable after unload', async () => {
  for (const signature of [Uint8Array.of(0xff), Uint8Array.of(0x40, 0, 1), Uint8Array.of(0x20, 0, 1)]) {
    const module = await load(managedFixture({ methods: [{ name: 'Bad', signature, noBody: true }] }));
    assert.equal(module.methodDefinition(0x06000001).isPublic, true);
    assert.throws(() => module.methodDefinition(0x06000001).callingConvention, error => error.code === LoadErrorCode.InvalidImage);
  }
  const oversized = await load(managedFixture({ methods: [{ name: 'Large', signature: new Uint8Array(1024 * 1024 + 1), noBody: true }] }));
  assert.throws(() => oversized.methodDefinition(0x06000001).callingConvention, error => error.code === LoadErrorCode.LimitExceeded);
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  const module = (await context.loadFromStream(managedFixture())).manifestModule;
  const method = module.methodDefinition(0x06000001);
  context.unload();
  assert.equal(method.isPublic, true);
  assert.equal(method.callingConvention, 1);
  await assert.rejects(context.loadFromStream(managedFixture()), error => error.code === LoadErrorCode.Disposed);
});
