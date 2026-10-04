import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSignature, encodeSignature, decodeTypeSignature, encodeTypeSignature } from '@sharpforge/cil';
import { substituteSignature, substituteTypeSignature, LoadErrorCode } from '../packages/clr/src/index.js';

const primitive = name => ({ kind: 'primitive', name });
const variable = (index = 0, scope = 'type') => ({ kind: 'genericParameter', scope, index });
const wrap = (kind, element) => ({ kind, element });
const arguments_ = { typeArguments: [primitive('string'), primitive('int')], methodArguments: [primitive('long')] };
const isCode = code => error => error.code === code;

test('CLR substitution independently replaces VAR and MVAR while preserving method header and receiver', () => {
  const signature = { kind: 'method', hasThis: true, explicitThis: true, callingConvention: 5,
    genericArity: 1, sentinel: 1, returnType: variable(0, 'method'),
    parameters: [variable(), wrap('byref', variable(1))] };
  const result = substituteSignature(signature, arguments_);
  assert.deepEqual(result, { ...signature, returnType: primitive('long'),
    parameters: [primitive('string'), wrap('byref', primitive('int'))] });
  assert.deepEqual(decodeSignature(encodeSignature(result)), result);
  assert.deepEqual(substituteSignature(signature, { typeArguments: arguments_.typeArguments }).returnType, variable(0, 'method'));
  assert.deepEqual(substituteTypeSignature(variable()), variable());
  assert.throws(() => substituteTypeSignature(variable(1), { typeArguments: [primitive('int')] }), /Unbound type generic parameter 1/);
  assert.throws(() => substituteTypeSignature(variable(0, 'method'), { methodArguments: [] }), /Unbound method/);
});

test('CLR substitution preserves nested generic instances, modifiers, array bounds and function pointer signatures', () => {
  const shape = { kind: 'array', element: variable(1), rank: 3, sizes: [4, 2], lowerBounds: [-1, 5] };
  const pointer = { kind: 'functionPointer', signature: { kind: 'method', returnType: primitive('void'),
    parameters: [wrap('pointer', variable()), wrap('byref', variable(0, 'method'))], callingConvention: 1 } };
  const input = { kind: 'genericInstance', type: { kind: 'class', token: 0x02000005 }, arguments: [
    { kind: 'modreq', token: 0x01000001, element: wrap('szarray', variable()) },
    { kind: 'modopt', token: 0x01000002, element: shape }, pointer,
  ] };
  const result = substituteTypeSignature(input, arguments_);
  assert.deepEqual(result.arguments[0], { kind: 'modreq', token: 0x01000001, element: wrap('szarray', primitive('string')) });
  assert.deepEqual(result.arguments[1].element, { ...shape, element: primitive('int') });
  assert.equal(result.arguments[2].signature.callingConvention, 1);
  assert.deepEqual(result.arguments[2].signature.parameters, [wrap('pointer', primitive('string')), wrap('byref', primitive('long'))]);
  assert.equal(result.type.token, input.type.token);
  assert.deepEqual(decodeTypeSignature(encodeTypeSignature(result)), result);
});

test('CLR substitution handles fields, properties, local pinned/byref slots and MethodSpec arguments', () => {
  const field = substituteSignature({ kind: 'field', type: variable() }, arguments_);
  assert.deepEqual(field, { kind: 'field', type: primitive('string') });
  const property = substituteSignature({ kind: 'property', hasThis: true, returnType: variable(1), parameters: [variable()] }, arguments_);
  assert.deepEqual(property, { kind: 'property', hasThis: true, returnType: primitive('int'), parameters: [primitive('string')] });
  const locals = substituteSignature({ kind: 'locals', types: [wrap('pinned', wrap('byref', variable())), primitive('int')] }, arguments_);
  assert.deepEqual(locals.types[0], wrap('pinned', wrap('byref', primitive('string'))));
  const spec = substituteSignature({ kind: 'methodSpec', arguments: [variable(), variable(0, 'method')] }, arguments_);
  assert.deepEqual(spec.arguments, [primitive('string'), primitive('long')]);
});

test('CLR substitution is simultaneous, deeply immutable and independent of caller mutations', () => {
  const original = { kind: 'field', type: wrap('szarray', variable()) };
  const argument = { kind: 'array', element: variable(0, 'method'), rank: 1, sizes: [3], lowerBounds: [-2] };
  const result = substituteSignature(original, { typeArguments: [argument], methodArguments: [primitive('long')] });
  assert.deepEqual(result.type.element.element, variable(0, 'method'));
  original.type.kind = 'pointer';
  argument.element.index = 4;
  argument.sizes[0] = 20;
  assert.equal(result.type.kind, 'szarray');
  assert.equal(result.type.element.element.index, 0);
  assert.deepEqual(result.type.element.sizes, [3]);
  assert.throws(() => { result.type.element.sizes[0] = 20; }, TypeError);
  assert.throws(() => { result.type.element.element.index = 9; }, TypeError);
  assert.deepEqual(substituteTypeSignature(variable(), { typeArguments: [wrap('szarray', variable())] }), wrap('szarray', variable()));
});

test('CLR substitution rejects malformed ASTs, invalid replacement forms and sparse arguments', () => {
  for (const input of [null, {}, variable(-1), variable(0, 'bad'), { kind: 'class', token: 0 }, wrap('unknown', variable())]) {
    assert.throws(() => substituteTypeSignature(input), isCode(LoadErrorCode.TypeLoad));
  }
  for (const argument of [primitive('void'), wrap('byref', primitive('int')), null]) {
    assert.throws(() => substituteTypeSignature(variable(), { typeArguments: [argument] }), isCode(LoadErrorCode.TypeLoad));
  }
  assert.throws(() => substituteTypeSignature(primitive('int'), { typeArguments: Array(1) }), isCode(LoadErrorCode.TypeLoad));
  assert.throws(() => substituteTypeSignature(variable(), { typeArguments: {} }), isCode(LoadErrorCode.TypeLoad));
  assert.throws(() => substituteTypeSignature(variable(), { typeArguments: Array(1025).fill(primitive('int')) }), /at most 1024/);
});

test('CLR substitution bounds cyclic/deep input, replacement amplification and cancellation', () => {
  const cycle = wrap('szarray', null);
  cycle.element = cycle;
  assert.throws(() => substituteTypeSignature(cycle), isCode(LoadErrorCode.LimitExceeded));
  assert.throws(() => substituteTypeSignature(wrap('szarray', variable()), { maxDepth: 0 }), isCode(LoadErrorCode.LimitExceeded));
  const repeated = { kind: 'locals', types: Array.from({ length: 8 }, () => variable()) };
  const argument = wrap('szarray', wrap('szarray', primitive('int')));
  assert.throws(() => substituteSignature(repeated, { typeArguments: [argument], maxNodes: 16 }), isCode(LoadErrorCode.LimitExceeded));
  for (const options of [{ maxNodes: 0 }, { maxDepth: 257 }, { maxDepth: 1.5 }]) {
    assert.throws(() => substituteTypeSignature(variable(), options), isCode(LoadErrorCode.InvalidConfiguration));
  }
  assert.throws(() => substituteTypeSignature(variable(), { signal: AbortSignal.abort() }), isCode(LoadErrorCode.Cancelled));
  assert.deepEqual(substituteTypeSignature(primitive('int'), { maxDepth: 0, maxNodes: 1 }), primitive('int'));
});
