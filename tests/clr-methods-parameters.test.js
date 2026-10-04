import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadSession, ParameterDesc, LoadErrorCode } from '../packages/clr/src/index.js';
import { MetadataParameters } from '../packages/clr/src/type-system/metadata-parameters.js';
import { managedFixture } from './managed-fixtures.js';

const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(managedFixture({
  methods: [{ name: 'Method', parameters: ['int', 'string'], result: 'void', noBody: true }], decorate,
}))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;

test('CLR parameter identities preserve position, flags, signature AST and lazy raw constants', async () => {
  const module = await load(({ md }) => {
    md.rows[8][0][0] = 0x11;
    md.rows[8][1][0] = 2;
    md.add(8, [0, 0, md.string('result')]);
    md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 42 });
  });
  const method = module.methodDefinition(0x06000001);
  const parameters = method.parameters;
  assert.ok(parameters[0] instanceof ParameterDesc);
  assert.throws(() => new ParameterDesc({}), TypeError);
  assert.equal(parameters, module.methodParameters(method.metadataToken).parameters);
  assert.equal(method.returnParameter, module.methodParameters(method.metadataToken).returnParameter);
  assert.ok(Object.isFrozen(parameters));
  assert.deepEqual(parameters.map(parameter => parameter.position), [0, 1]);
  assert.equal(parameters[0].name, 'arg0');
  assert.equal(parameters[0].metadataToken, 0x08000001);
  assert.equal(parameters[0].method, method);
  assert.equal(parameters[0].module, module);
  assert.equal(parameters[0].signatureType, method.signature.parameters[0]);
  assert.equal(parameters[0].isIn, true);
  assert.equal(parameters[0].isOptional, true);
  assert.equal(parameters[1].isOut, true);
  assert.deepEqual(parameters[0].constant, { type: 8, value: 42 });
  assert.equal(parameters[0].constant, parameters[0].constant);
  assert.ok(Object.isFrozen(parameters[0].constant));
  assert.equal(parameters[1].constant, null);
  assert.equal(method.returnParameter.position, -1);
  assert.equal(method.returnParameter.name, 'result');
  assert.equal(method.returnParameter.signatureType.name, 'void');
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR missing Param rows have canonical positional identities and ParamPtr lists retain signature order', async () => {
  const missing = (await load(({ md }) => { md.rows[8] = []; })).methodDefinition(0x06000001);
  assert.deepEqual(missing.parameters.map(parameter => [parameter.position, parameter.metadataToken, parameter.name]),
    [[0, 0, null], [1, 0, null]]);
  assert.equal(missing.returnParameter.metadataToken, 0);
  assert.equal(missing.returnParameter.constant, null);
  const module = await load(({ md }) => {
    md.uncompressed = true;
    md.add(7, [2]);
    md.add(7, [1]);
  });
  assert.deepEqual(module.list(0x06000001, 'ParamList'), [0x08000002, 0x08000001]);
  assert.deepEqual(module.methodDefinition(0x06000001).parameters.map(parameter => parameter.metadataToken),
    [0x08000001, 0x08000002]);
});

test('CLR parameter metadata rejects duplicate/out-of-range sequences, ownership and names', async () => {
  for (const sequence of [1, 3]) {
    const module = await load(({ md }) => { md.rows[8][1][1] = sequence; });
    assert.throws(() => module.methodParameters(0x06000001), invalid);
  }
  const duplicate = await load(({ md }) => {
    md.uncompressed = true;
    md.add(7, [1]);
    md.add(7, [1]);
  });
  assert.throws(() => duplicate.methodParameters(0x06000001), invalid);
  const reused = (await new AssemblyLoadSession().createContext().loadFromStream(managedFixture({ methods: [
    { name: 'First', parameters: ['int'], noBody: true }, { name: 'Second', parameters: ['int'], noBody: true },
  ], decorate({ md }) {
    md.uncompressed = true;
    md.add(7, [1]);
    md.add(7, [1]);
  } }))).manifestModule;
  reused.methodParameters(0x06000001);
  assert.throws(() => reused.methodParameters(0x06000002), invalid);
  const longName = await load(({ md }) => { md.rows[8][0][2] = md.string('x'.repeat(4097)); });
  assert.throws(() => longName.methodParameters(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
  const module = await load();
  for (const token of [0, 0x08000001, 0x06000002, 0x106000001]) assert.throws(() => module.methodParameters(token), invalid);
});

test('CLR parameter constants diagnose flag disagreement, duplicate rows and malformed primitive payloads lazily', async () => {
  const cases = [
    ({ md }) => { md.rows[8][0][0] = 0x1000; },
    ({ md }) => {
      md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 1 });
      md.rows[8][0][0] = 0;
    },
    ({ md }) => {
      md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 1 });
      md.add(11, [...md.rows[11][0]]);
    },
    ({ md }) => {
      md.rows[8][0][0] = 0x1000;
      md.add(11, [8, 5, md.blob(Uint8Array.of(1))]);
    },
  ];
  for (const decorate of cases) {
    const method = (await load(decorate)).methodDefinition(0x06000001);
    assert.equal(method.parameters.length, 2);
    assert.throws(() => method.parameters[0].constant, invalid);
  }
});

test('CLR parameter indexing rejects oversized Param/ParamPtr/Constant tables before row access', () => {
  for (const table of [7, 8, 11]) {
    const service = new MetadataParameters({ rowCount: actual => actual === table ? 100001 : 0 });
    assert.throws(() => service.forMethod(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
  }
  const service = new MetadataParameters({ rowCount: () => 0,
    methodDefinition: () => ({ signature: { parameters: { length: 100000 } } }),
  });
  assert.throws(() => service.forMethod(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
});
