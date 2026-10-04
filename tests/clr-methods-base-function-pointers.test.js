import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { OverrideSignatures } from '../packages/clr/src/type-system/override-signature.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';

const primitive = name => ({ kind: 'primitive', name });
const integer = primitive('int');
const pointer = (returnType = integer, parameters = [integer], options = {}) => ({ kind: 'functionPointer',
  signature: { kind: 'method', returnType, parameters, ...options } });
const signature = type => encodeSignature({ kind: 'method', hasThis: true, returnType: integer, parameters: [type] });
const fails = code => error => error.code === code;
const load = async (context, image) => (await context.loadFromStream(image)).manifestModule;
function fixture(makeType, decorate) {
  return hierarchyFixture(({ md }) => {
    for (const row of [0, 3, 6]) md.rows[6][row][4] = md.blob(signature(makeType(row, md)));
    decorate?.(md);
  });
}

test('CLR function-pointer override keys match exact managed/unmanaged nested signatures without bodies', async () => {
  for (const callingConvention of [0, 1, 2, 3, 4, 9]) {
    const image = fixture(() => pointer({ kind: 'pointer', element: integer }, [
      pointer(), { kind: 'byref', element: integer }, { kind: 'szarray', element: primitive('string') },
    ], { callingConvention }));
    const context = baseContext({ isCollectible: true }), module = await load(context, image);
    const method = module.methodDefinition(0x06000007), root = module.methodDefinition(0x06000001);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(module.methodBodyReadCount, 0);
    context.unload();
    assert.equal(await method.getBaseDefinition(), root);
    await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
  }
});

test('CLR function-pointer convention, arity, return/parameter type and nested shape mismatches retain distinct slots', async () => {
  const different = [
    pointer(integer, [integer], { callingConvention: 1 }),
    pointer(integer, [integer, integer]),
    pointer(primitive('long')),
    pointer(integer, [primitive('long')]),
    pointer(integer, [pointer()]),
  ];
  for (const other of different) {
    const image = fixture(row => row === 6 ? other : pointer(), md => { md.rows[2][1][3] = 0; });
    const module = await load(baseContext(), image), method = module.methodDefinition(0x06000007);
    assert.equal(await method.getBaseDefinition(), method);
  }
});

test('CLR function-pointer element identity reuses canonical type references and modifier keys', async () => {
  let marker;
  const image = fixture((row, md) => {
    if (!marker) marker = md.add(2, [1, md.string('Marker'), md.string('Fixture'), 0, 1, md.rows[6].length + 1]);
    const token = row === 6 ? md.add(1, [codedIndex('ResolutionScope', 1), md.string('Marker'), md.string('Fixture')]) : marker;
    const element = { kind: 'class', token };
    return pointer({ kind: 'modopt', token, element }, [element], { callingConvention: 9 });
  });
  const module = await load(baseContext(), image);
  assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
});

test('CLR method generic positions remain scoped outside nongeneric function-pointer signatures', async () => {
  const image = fixture(() => pointer({ kind: 'genericParameter', scope: 'method', index: 0 }), md => {
    for (const row of [0, 3, 6]) {
      md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001 + row), md.string(`T${row}`)]);
      md.rows[6][row][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true, genericArity: 1,
        returnType: integer, parameters: [pointer({ kind: 'genericParameter', scope: 'method', index: 0 })] }));
    }
  });
  const module = await load(baseContext(), image);
  assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
});

test('CLR unsupported generic, instance and vararg function-pointer headers fail explicitly', async () => {
  for (const options of [{ genericArity: 1 }, { hasThis: true }, { hasThis: true, explicitThis: true },
    { callingConvention: 5 }, { callingConvention: 5, sentinel: 0 }, { callingConvention: 11 }]) {
    const module = await load(baseContext(), fixture(() => pointer(integer, [integer], options)));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR function-pointer generic argument subtrees stay unsupported under arrays and nested instances', async () => {
  for (const nested of [false, true]) {
    let box;
    const image = fixture((row, md) => {
      if (!box) {
        box = md.add(2, [1, md.string('Box`1'), md.string('Fixture'), 0, 1, md.rows[6].length + 1]);
        md.add(42, [0, 0, codedIndex('TypeOrMethodDef', box), md.string('T')]);
      }
      const instance = argument => ({ kind: 'genericInstance', type: { kind: 'class', token: box }, arguments: [argument] });
      const array = { kind: 'szarray', element: pointer() };
      return instance(nested ? instance(array) : array);
    });
    const module = await load(baseContext(), image);
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(),
      error => error.code === LoadErrorCode.TypeLoad && error.message.includes('argument subtrees'));
  }
});

test('CLR function-pointer recursion and identity budgets apply before publishing a signature key', async () => {
  const deep = await load(baseContext(), fixture(() => pointer(), md => {
    const prefix = Array.from({ length: 65 }, () => [0x1b, 0, 1, 8]).flat();
    md.rows[6][6][4] = md.blob(Uint8Array.from([0x20, 1, 8, ...prefix, 8]));
  }));
  await assert.rejects(deep.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.InvalidImage));
  const context = baseContext(), module = await load(context, fixture(() => pointer(integer, [primitive('string')])));
  await assert.rejects(new OverrideSignatures(context.types, 1).key(module.methodDefinition(0x06000007)), fails(LoadErrorCode.LimitExceeded));
});

test('CLR cancellation during function-pointer type binding permits a later canonical retry', async () => {
  const controller = new AbortController();
  let first = true;
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    if (name === 'Marker' && first) { first = false; controller.abort(); }
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  context.types.defineIntrinsic('System.Marker');
  const image = fixture((row, md) => pointer({ kind: 'class', token: md.typeRef('System.Marker') }));
  const module = await load(context, image), method = module.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: controller.signal }), fails(LoadErrorCode.Cancelled));
  assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001));
});
