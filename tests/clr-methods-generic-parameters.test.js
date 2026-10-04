import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession, TypeKind, LoadErrorCode } from '../packages/clr/src/index.js';
import { createMethodDesc } from '../packages/clr/src/type-system/method-desc.js';
import { managedFixture } from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-generic-parameters/native-parameters.json', import.meta.url)));
const load = async image => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
const signature = genericArity => encodeSignature({ kind: 'method', hasThis: false, genericArity,
  returnType: { kind: 'primitive', name: 'void' }, parameters: [] });

test('CLR method-owned generic parameter identities match independent CoreCLR reflection and SRM', async () => {
  const image = Buffer.from(native.image, 'base64');
  const module = await load(image);
  const other = await load(image);
  assert.match(native.runtime, /^\.NET 10\./);
  assert.equal(native.methods.length, 4);
  for (const expected of native.methods) {
    const method = module.methodDefinition(expected.token);
    assert.equal(method.name, expected.name);
    assert.equal(method.declaringType.metadataToken, expected.declaringType);
    assert.equal(method.genericParameters, module.methodGenericParameters(expected.token));
    assert.equal(method.genericParameters.length, expected.parameters.length);
    assert.equal(method.signature.genericArity, expected.parameters.length);
    assert.ok(Object.isFrozen(method.genericParameters));
    for (const item of expected.parameters) {
      const type = module.genericParameter(item.token);
      assert.equal(type, method.genericParameters[item.position]);
      assert.notEqual(type, other.genericParameter(item.token));
      assert.equal(type.kind, TypeKind.GenericParameter);
      assert.equal(type.name, item.name);
      assert.equal(type.namespace, item.namespace);
      assert.equal(type.fullName, item.fullName);
      assert.equal(String(type), item.text);
      assert.equal(type.declaringType, method.declaringType);
      assert.equal(type.declaringType.fullName, item.owner);
      assert.equal(type.declaringMethod.metadataToken, item.declaringMethod);
      assert.equal(type.declaringMethod, method);
      assert.equal(type.genericParameterOwner, method);
      assert.equal(type.genericParameterPosition, item.position);
      assert.equal(type.genericParameterAttributes, item.attributes);
      assert.deepEqual(type.genericParameterConstraintTokens, item.constraints);
      assert.equal(type.isLoaded, false);
      assert.equal(type.module, module);
      assert.ok(Object.isFrozen(type));
    }
  }
  const typeParameter = module.typeDefinition(native.definitions[0].token).genericParameters[0];
  assert.equal(typeParameter.declaringMethod, null);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR method generic parameter arity and owner validation reject inconsistent metadata', async () => {
  for (const [arity, count] of [[0, 1], [2, 1], [1, 0]]) {
    const module = await load(managedFixture({ methods: [{ name: 'Generic', noBody: true, signature: signature(arity) }],
      decorate({ md }) {
        for (let index = 0; index < count; index++) md.add(42, [index, 0, 3, md.string('T' + index)]);
      } }));
    assert.throws(() => module.methodDefinition(0x06000001).genericParameters,
      error => error.code === LoadErrorCode.TypeLoad && /signature arity/.test(error.message));
    if (count) assert.throws(() => module.genericParameter(0x2a000001), /signature arity/);
  }
  const module = await load(managedFixture());
  for (const token of [0, 0x02000002, 0x06000000, 0x06000002, 0x106000001]) {
    assert.throws(() => module.methodGenericParameters(token), error => error.code === LoadErrorCode.InvalidImage);
  }
  const oversized = await load(managedFixture({ methods: [{ name: 'Oversized', noBody: true, signature: signature(1025) }] }));
  assert.throws(() => oversized.methodGenericParameters(0x06000001), error => error.code === LoadErrorCode.LimitExceeded);
});

test('CLR method descriptors memoize empty and populated generic parameter arrays', () => {
  for (const parameters of [Object.freeze([]), Object.freeze([{ name: 'T' }])]) {
    let reads = 0;
    const module = { methodGenericParameters(token) {
      assert.equal(token, 0x06000001);
      reads++;
      return parameters;
    } };
    const method = createMethodDesc({ module, token: 0x06000001 });
    assert.equal(method.genericParameters, parameters);
    assert.equal(method.genericParameters, parameters);
    assert.equal(reads, 1);
  }
});
