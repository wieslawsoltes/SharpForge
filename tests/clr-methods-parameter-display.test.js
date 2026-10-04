import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature, propertySignature } from '@sharpforge/cil';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const primitive = name => ({ kind: 'primitive', name });
const fails = code => error => error.code === code;
async function fixture(types, decorate, signature = {}) {
  const image = managedFixture({ entry: null, methods: [{ name: 'M', parameters: types.map(() => 'int'),
    signature: encodeSignature({ kind: 'method', returnType: primitive('void'), parameters: types, ...signature }), noBody: true }],
  decorate });
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  return (await context.loadFromStream(image)).manifestModule;
}

test('CLR ParameterInfo strings use type names and ampersands without reading constants or method bodies', async () => {
  const module = await fixture([primitive('int'), primitive('string'), primitive('object'),
    { kind: 'byref', element: primitive('int') }, { kind: 'array', element: primitive('int'), rank: 2, sizes: [], lowerBounds: [] },
    { kind: 'pointer', element: primitive('void') }], ({ md }) => { md.rows[8][0][0] = 0x1000; });
  const method = module.methodDefinition(0x06000001);
  assert.deepEqual(method.parameters.map(String), ['Int32 arg0', 'System.String arg1', 'System.Object arg2',
    'Int32& arg3', 'Int32[,] arg4', 'Void* arg5']);
  assert.equal(method.returnParameter.toString(), 'Void');
  assert.throws(() => method.parameters[0].constant, fails(LoadErrorCode.InvalidImage));
  assert.equal(module.methodBodyReadCount, 0);
  assert.equal(module.assembly.loadContext.assemblies.length, 1);
});

test('CLR parameter display distinguishes omitted names, empty names and explicit return names', async () => {
  const missing = await fixture([primitive('int')], ({ md }) => { md.rows[8] = []; });
  assert.equal(String(missing.methodDefinition(0x06000001).parameters[0]), 'Int32');
  const present = await fixture([primitive('int')], ({ md }) => {
    md.rows[8][0][2] = 0;
    md.add(8, [0, 0, md.string('result')]);
  });
  const method = present.methodDefinition(0x06000001);
  assert.equal(String(method.parameters[0]), 'Int32 ');
  assert.equal(String(method.returnParameter), 'Void result');
});

test('CLR parameter displays share bounded generic naming and ignore valid modifiers', async () => {
  const variable = { kind: 'genericParameter', scope: 'method', index: 0 };
  const module = await fixture([primitive('int'), primitive('int')], ({ md }) => {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001), md.string('Element')]);
    const list = md.typeRef('System.Collections.Generic.List`1');
    const type = { kind: 'genericInstance', type: { kind: 'class', token: list },
      arguments: [{ kind: 'szarray', element: variable }] };
    md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', returnType: variable, genericArity: 1,
      parameters: [type, { kind: 'modreq', token: 0x02000002, element: { kind: 'byref', element: primitive('int') } }] }));
  });
  const method = module.methodDefinition(0x06000001);
  assert.equal(String(method.parameters[0]), 'System.Collections.Generic.List`1[Element[]] arg0');
  assert.equal(String(method.parameters[1]), 'Int32& arg1');
  assert.equal(String(method.returnParameter), 'Element');
  assert.equal(method.parameters[1].signatureType.kind, 'modreq');
});

test('CLR property index-parameter display retains accessor type/name and property ownership', async () => {
  const image = managedFixture({ methods: [{ name: 'get_Item', parameters: ['string'], result: 'int', static: false, noBody: true }],
    decorate({ md, resolve }) {
      md.add(23, [0, md.string('Item'), md.blob(propertySignature('int', ['string'], false, resolve))]);
      md.add(21, [2, 1]);
      md.add(24, [2, 1, 3]);
      md.rows[8][0][2] = md.string('key');
    } });
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
  const property = module.propertyDefinition(0x17000001), parameter = property.indexParameters[0];
  assert.equal(String(parameter), 'System.String key');
  assert.equal(parameter.toString(), property.getMethod.parameters[0].toString());
  assert.equal(parameter.member, property);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR parameter displays reject unsupported and malformed types and preserve formatter limits', async () => {
  const functionPointer = { kind: 'functionPointer', signature: { kind: 'method', returnType: primitive('void'), parameters: [] } };
  for (const [type, code] of [[functionPointer, LoadErrorCode.TypeLoad],
    [{ kind: 'class', token: 0x020000ff }, LoadErrorCode.InvalidImage]]) {
    const method = (await fixture([type])).methodDefinition(0x06000001);
    assert.throws(() => method.parameters[0].toString(), fails(code));
  }
  const variable = { kind: 'genericParameter', scope: 'method', index: 0 };
  const excessive = await fixture([variable], ({ md }) => {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001), md.string('X'.repeat(16385))]);
  }, { genericArity: 1 });
  assert.throws(() => excessive.methodDefinition(0x06000001).parameters[0].toString(), fails(LoadErrorCode.LimitExceeded));
});

test('CLR cached parameter displays retain metadata identity through cooperative unloading', async () => {
  const module = await fixture([primitive('string')]);
  const parameter = module.methodDefinition(0x06000001).parameters[0];
  assert.equal(parameter.toString(), 'System.String arg0');
  module.assembly.loadContext.unload();
  assert.equal(parameter.toString(), 'System.String arg0');
  assert.equal(parameter, module.methodDefinition(0x06000001).parameters[0]);
});
