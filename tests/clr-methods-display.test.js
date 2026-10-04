import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const primitive = name => ({ kind: 'primitive', name });
const methodSignature = (returnType = primitive('void'), parameters = [], extra = {}) =>
  encodeSignature({ kind: 'method', returnType, parameters, ...extra });
async function fixture(signatures, decorate) {
  const image = managedFixture({ entry: null, methods: signatures.map((signature, index) => ({
    name: `M${index}`, flags: 0x16, signature, noBody: true,
  })), decorate });
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  return (await context.loadFromStream(image)).manifestModule;
}
const fails = code => error => error.code === code;

test('CLR method displays use Reflection primitive names, qualified references and parameter ByRef syntax', async () => {
  const module = await fixture([
    methodSignature(primitive('int'), [primitive('string'), primitive('object'), primitive('bool')]),
    methodSignature({ kind: 'byref', element: primitive('int') }, [{ kind: 'byref', element: primitive('string') }]),
    methodSignature({ kind: 'szarray', element: primitive('int') }, [
      { kind: 'array', element: primitive('int'), rank: 2, sizes: [], lowerBounds: [0, 0] },
      { kind: 'array', element: primitive('string'), rank: 1, sizes: [], lowerBounds: [] },
      { kind: 'pointer', element: primitive('void') },
    ]),
    methodSignature(primitive('void'), [primitive('int')], { callingConvention: 5 }),
  ]);
  const expected = ['Int32 M0(System.String, System.Object, Boolean)', 'Int32& M1(System.String ByRef)',
    'Int32[] M2(Int32[,], System.String[*], Void*)', 'Void M3(Int32, ...)'];
  expected.forEach((value, index) => {
    const method = module.methodDefinition(0x06000001 + index);
    assert.equal(method.toString(), value);
    assert.equal(String(method), value);
  });
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR constructor and type-initializer MethodDefs render Void and preserve metadata names', async () => {
  const module = await fixture([
    methodSignature(primitive('void'), [primitive('int')], { hasThis: true }), methodSignature(),
  ], ({ md }) => {
    md.rows[6][0][2] = 0x1886;
    md.rows[6][0][3] = md.string('.ctor');
    md.rows[6][1][2] = 0x1891;
    md.rows[6][1][3] = md.string('.cctor');
  });
  assert.equal(module.methodDefinition(0x06000001).toString(), 'Void .ctor(Int32)');
  assert.equal(module.methodDefinition(0x06000002).toString(), 'Void .cctor()');
});

test('CLR displays reuse metadata names and generic parameter ownership without loading referenced assemblies', async () => {
  const variable = { kind: 'genericParameter', scope: 'type', index: 0 };
  const methodVariable = { kind: 'genericParameter', scope: 'method', index: 0 };
  const module = await fixture([
    methodSignature({ kind: 'class', token: 0x02000002 }),
    methodSignature(methodVariable, [variable, methodVariable], { genericArity: 1 }),
    methodSignature(), methodSignature(),
  ], ({ md }) => {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x02000002), md.string('T')]);
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000002), md.string('U')]);
    const list = md.typeRef('System.Collections.Generic.List`1');
    const nested = md.add(2, [2, md.string('Nested'), 0, 0, 1, 5]);
    md.add(41, [nested & 0xffffff, 2]);
    md.rows[6][2][4] = md.blob(methodSignature({ kind: 'genericInstance',
      type: { kind: 'class', token: list }, arguments: [primitive('int')] }));
    md.rows[6][3][4] = md.blob(methodSignature({ kind: 'class', token: nested }, [{ kind: 'szarray', element: { kind: 'class', token: nested } }]));
  });
  assert.equal(module.methodDefinition(0x06000001).toString(), 'Fixture.Program M0()');
  assert.equal(module.methodDefinition(0x06000002).toString(), 'U M1[U](T, U)');
  assert.equal(module.methodDefinition(0x06000003).toString(), 'System.Collections.Generic.List`1[System.Int32] M2()');
  assert.equal(module.methodDefinition(0x06000004).toString(), 'Nested M3(Nested[])');
  assert.equal(module.typeName(0x02000003), 'Fixture.Program+Nested');
});

test('CLR method display ignores valid custom modifiers without changing the cached signature', async () => {
  const module = await fixture([methodSignature({ kind: 'modopt', token: 0x02000002, element: primitive('int') }, [
    { kind: 'byref', element: { kind: 'modreq', token: 0x02000002, element: primitive('int') } },
  ])]);
  const method = module.methodDefinition(0x06000001);
  assert.equal(method.toString(), 'Int32 M0(Int32 ByRef)');
  assert.equal(method.signature.returnType.kind, 'modopt');
  module.assembly.loadContext.unload();
  assert.equal(method.toString(), 'Int32 M0(Int32 ByRef)');
});

test('CLR unsupported display forms reject instead of inventing resolved runtime type names', async () => {
  const inputs = [
    methodSignature({ kind: 'functionPointer', signature: { kind: 'method', returnType: primitive('void'), parameters: [] } }),
    methodSignature({ kind: 'array', element: primitive('int'), rank: 1, sizes: [2], lowerBounds: [] }),
    methodSignature(primitive('void'), [], { callingConvention: 1 }),
  ];
  const module = await fixture(inputs);
  for (let row = 1; row <= inputs.length; row++) {
    assert.throws(() => module.methodDefinition(0x06000000 + row).toString(), fails(LoadErrorCode.TypeLoad));
  }
  for (const name of ['System.Int32', 'Fixture.Comma,Name']) {
    const named = await fixture([methodSignature()], ({ md }) => {
      md.rows[6][0][4] = md.blob(methodSignature({ kind: 'valuetype', token: md.typeRef(name) }));
    });
    assert.throws(() => named.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR method displays reject malformed named tokens and generic positions with stable diagnostics', async () => {
  for (const type of [{ kind: 'class', token: 0x020000ff }, { kind: 'genericParameter', scope: 'method', index: 1 }]) {
    const module = await fixture([methodSignature(type)]);
    assert.throws(() => module.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.InvalidImage));
  }
  const module = await fixture([methodSignature()]);
  for (const token of [0, 0x02000000, 0x020000ff, 0x1b000001, -1, 1n, Symbol('type')]) {
    assert.throws(() => module.typeName(token), fails(LoadErrorCode.InvalidImage));
  }
  const deep = await fixture([methodSignature()], ({ md }) => {
    const list = { kind: 'class', token: md.typeRef('Fixture.List`1') };
    let type = primitive('int');
    for (let depth = 0; depth < 33; depth++) type = { kind: 'genericInstance', type: list, arguments: [type] };
    md.rows[6][0][4] = md.blob(methodSignature(type));
  });
  assert.throws(() => deep.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.InvalidImage));
});

test('CLR display parameter, metadata string, generic name and formatted output budgets are enforced', async () => {
  const many = await fixture([methodSignature(primitive('void'), Array(257).fill(primitive('int')))]);
  assert.throws(() => many.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.LimitExceeded));
  const long = await fixture([methodSignature()], ({ md }) => {
    const reference = md.typeRef('Fixture.' + 'X'.repeat(16385));
    md.rows[6][0][4] = md.blob(methodSignature({ kind: 'class', token: reference }));
  });
  assert.throws(() => long.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.LimitExceeded));
  const generic = await fixture([methodSignature(primitive('void'), [], { genericArity: 1 })], ({ md }) => {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001), md.string('X'.repeat(16385))]);
  });
  assert.throws(() => generic.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.LimitExceeded));
  const expanded = await fixture([methodSignature()], ({ md }) => {
    const reference = { kind: 'class', token: md.typeRef('Fixture.' + 'Long'.repeat(64)) };
    md.rows[6][0][4] = md.blob(methodSignature(primitive('void'), Array(100).fill(reference)));
  });
  assert.throws(() => expanded.methodDefinition(0x06000001).toString(), fails(LoadErrorCode.LimitExceeded));
});
