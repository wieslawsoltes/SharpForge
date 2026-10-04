import test from 'node:test';
import assert from 'node:assert/strict';
import { propertySignature } from '@sharpforge/cil';
import { AssemblyLoadSession, ParameterDesc, LoadErrorCode } from '../packages/clr/src/index.js';
import { MetadataPropertyParameters } from '../packages/clr/src/type-system/metadata-property-parameters.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => managedFixture({ methods: [
  { name: 'get_Item', parameters: ['int', 'string'], result: 'int', static: false, noBody: true },
  { name: 'set_Item', parameters: ['int', 'string', 'int'], static: false, noBody: true },
], decorate(context) {
  const { md } = context;
  md.add(23, [0, md.string('Item'), md.blob(propertySignature('int', ['int', 'string'], false, context.resolve))]);
  md.add(21, [2, 1]);
  md.add(24, [2, 1, 3]);
  md.add(24, [1, 2, 3]);
  md.rows[8][0][2] = md.string('getterIndex');
  md.rows[8][2][2] = md.string('setterIndex');
  decorate?.(context);
} });
const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(fixture(decorate))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;

test('CLR property index parameters prefer getters and retain canonical property ownership with shared raw constants', async () => {
  const module = await load(({ md }) => {
    md.rows[8][0][0] = 0x11;
    md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 7 });
    md.rows[6][1][4] = md.blob(Uint8Array.of(0xff));
  });
  const property = module.propertyDefinition(0x17000001);
  const source = property.getMethod.parameters[0];
  const parameters = property.indexParameters;
  assert.equal(parameters, module.propertyParameters(property.metadataToken));
  assert.equal(parameters, property.indexParameters);
  assert.ok(Object.isFrozen(parameters));
  assert.equal(parameters.length, 2);
  assert.ok(parameters[0] instanceof ParameterDesc);
  assert.ok(Object.isFrozen(parameters[0]));
  assert.notEqual(parameters[0], source);
  assert.equal(parameters[0].member, property);
  assert.equal(source.member, source.method);
  assert.equal(parameters[0].method, property.getMethod);
  assert.equal(parameters[0].module, module);
  assert.equal(parameters[0].name, 'getterIndex');
  assert.equal(parameters[0].metadataToken, source.metadataToken);
  assert.equal(parameters[0].signatureType, source.signatureType);
  assert.equal(parameters[0].isIn, true);
  assert.equal(parameters[0].isOptional, true);
  assert.deepEqual(parameters.map(parameter => parameter.position), [0, 1]);
  assert.deepEqual(parameters[0].constant, { type: 8, value: 7 });
  assert.equal(parameters[0].constant, source.constant);
  assert.equal(parameters[1].constant, null);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR write-only index parameters exclude the setter value and preserve missing Param rows and pointer order', async () => {
  const setter = await load(({ md }) => { md.rows[24].shift(); });
  const property = setter.propertyDefinition(0x17000001);
  assert.deepEqual(property.indexParameters.map(parameter => parameter.name), ['setterIndex', 'arg1']);
  assert.equal(property.indexParameters[0].method, property.setMethod);
  assert.equal(property.setMethod.parameters.length, 3);
  const missing = await load(({ md }) => {
    md.rows[8] = [];
    for (const method of md.rows[6]) method[5] = 1;
  });
  assert.deepEqual(missing.propertyDefinition(0x17000001).indexParameters.map(parameter =>
    [parameter.name, parameter.metadataToken, parameter.constant]), [[null, 0, null], [null, 0, null]]);
  const pointers = await load(({ md }) => {
    md.uncompressed = true;
    for (const rid of [2, 1, 5, 4, 3]) md.add(7, [rid]);
  });
  assert.deepEqual(pointers.propertyDefinition(0x17000001).indexParameters.map(parameter => parameter.metadataToken),
    [0x08000001, 0x08000002]);
  const absent = await load(({ md }) => { md.rows[24] = []; });
  const empty = absent.propertyDefinition(0x17000001).indexParameters;
  assert.deepEqual(empty, []);
  assert.ok(Object.isFrozen(empty));
});

test('CLR property parameter errors preserve lazy Constant and accessor signature diagnostics', async () => {
  const constant = await load(({ md }) => { md.rows[8][0][0] = 0x1000; });
  const property = constant.propertyDefinition(0x17000001);
  assert.equal(property.indexParameters.length, 2);
  assert.throws(() => property.indexParameters[0].constant, invalid);
  const signature = await load(({ md }) => { md.rows[6][0][4] = md.blob(Uint8Array.of(0xff)); });
  assert.throws(() => signature.propertyDefinition(0x17000001).indexParameters, invalid);
  const names = await load(({ md }) => { md.rows[8][0][2] = md.string('x'.repeat(4097)); });
  assert.throws(() => names.propertyParameters(0x17000001), error => error.code === LoadErrorCode.LimitExceeded);
  for (const token of [0, 0x06000001, 0x17000002, 0x117000001]) assert.throws(() => constant.propertyParameters(token), invalid);
});

test('CLR property projection bounds descriptors before allocation and rejects a setter without its value parameter', () => {
  const oversized = new MetadataPropertyParameters({ propertyDefinition: () => ({ getMethod: { parameters: { length: 100001 } } }) });
  assert.throws(() => oversized.get(0x17000001), error => error.code === LoadErrorCode.LimitExceeded);
  const invalidSetter = new MetadataPropertyParameters({ propertyDefinition: () => ({ setMethod: { parameters: [] } }) });
  assert.throws(() => invalidSetter.get(0x17000001), invalid);
});

test('CLR property parameter identities stay context-local and retain usable metadata through cooperative unload', async () => {
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  const module = (await context.loadFromStream(fixture())).manifestModule;
  const property = module.propertyDefinition(0x17000001);
  const parameters = property.indexParameters;
  assert.notEqual(parameters[0], (await load()).propertyDefinition(0x17000001).indexParameters[0]);
  context.unload();
  assert.equal(property.indexParameters, parameters);
  assert.equal(parameters[0].member, property);
  assert.equal(parameters[0].constant, null);
  await assert.rejects(context.loadFromStream(fixture()), error => error.code === LoadErrorCode.Disposed);
});
