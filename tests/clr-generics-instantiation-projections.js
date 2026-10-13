import assert from 'node:assert/strict';
import { cliSystemName, encodeTypeSignature } from '@sharpforge/cil';
import { TypeKind } from '../packages/clr/src/index.js';
import { canonicalNativeShape } from './clr-generics-instantiation-native.js';

const sorted = values => values.sort((left, right) => {
  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});

export function compareNativeType(replay, type, expected, label) {
  assert.deepEqual(replay.shape(type), canonicalNativeShape(expected.shape), `${label}: canonical shape`);
  const definition = type.genericDefinition ?? type;
  const isGenericTypeDefinition = type.genericDefinition === null && type.genericParameters.length > 0;
  const isGenericType = isGenericTypeDefinition || type.genericDefinition !== null;
  assert.equal(isGenericTypeDefinition, expected.isGenericTypeDefinition, `${label}: generic definition`);
  assert.equal(isGenericType, expected.isGenericType, `${label}: generic type`);
  assert.equal(type.isInterface, expected.isInterface, `${label}: interface category`);
  assert.equal([TypeKind.ValueType, TypeKind.Enum].includes(definition.kind), expected.isValueType, `${label}: value category`);
  if (type.kind !== TypeKind.FunctionPointer) {
    assert.equal(type.containsGenericParameters, expected.containsGenericParameters, `${label}: open/closed flag`);
    assert.equal(type.isCollectible, expected.isCollectible, `${label}: collectible ownership`);
  }
  assert.deepEqual(replay.shape(isGenericType ? definition : null), canonicalNativeShape(expected.genericDefinition), `${label}: definition`);
  const arguments_ = isGenericTypeDefinition ? type.genericParameters : type.genericArguments;
  assert.deepEqual(arguments_.map(argument => replay.shape(argument)),
    (expected.genericArguments ?? []).map(canonicalNativeShape), `${label}: ordered arguments`);
  assert.deepEqual(type.genericParameters.map(parameter => parameter.genericParameterAttributes),
    expected.genericParameterAttributes ?? [], `${label}: declaration attributes`);
  assert.deepEqual(replay.shape(type.declaringType), canonicalNativeShape(expected.declaringType), `${label}: declaring type`);
  const intrinsic = expected.shape.kind === 'intrinsic' || expected.shape.definition?.kind === 'intrinsic';
  if (!intrinsic && type.kind !== TypeKind.FunctionPointer) {
    assert.deepEqual(replay.shape(type.baseType), canonicalNativeShape(expected.baseType), `${label}: substituted base`);
    assert.deepEqual(sorted(type.interfaces.map(contract => replay.shape(contract))),
      sorted((expected.interfaces ?? []).map(canonicalNativeShape)), `${label}: substituted interfaces`);
  }
  if (expected.module) {
    assert.equal(type.metadataToken, expected.metadataToken, `${label}: defining token`);
    const scope = replay.shape(type.genericDefinition ?? type);
    assert.equal(scope.image, expected.module, `${label}: defining image`);
    assert.equal(scope.context, expected.context, `${label}: defining context`);
  }
  return intrinsic ? 'host-intrinsic-shape' : type.kind === TypeKind.FunctionPointer ? 'function-pointer-shape' : 'fixture-type-graph';
}

/** Project the public lossless CIL AST to SRM's independent signature-provider vocabulary. */
export function srmSignatureShape(node) {
  if (node.kind === 'primitive') return { kind: node.kind, code: encodeTypeSignature(node, { context: 'return' })[0],
    name: cliSystemName(node.name).slice('System.'.length) };
  if (node.kind === 'class' || node.kind === 'valuetype') {
    return node.token >>> 24 === 27 ? { kind: 'specification', token: node.token, rawTypeKind: node.kind === 'class' ? 0x12 : 0x11 }
      : { kind: node.kind, token: node.token };
  }
  if (node.kind === 'genericParameter') return { kind: node.kind, scope: node.scope, index: node.index };
  if (node.kind === 'genericInstance') return { kind: node.kind, type: srmSignatureShape(node.type),
    arguments: node.arguments.map(srmSignatureShape) };
  if (node.kind === 'functionPointer') {
    const signature = node.signature;
    return { kind: node.kind, callingConvention: signature.callingConvention, hasThis: signature.hasThis,
      explicitThis: signature.explicitThis, genericArity: signature.genericArity, returnType: srmSignatureShape(signature.returnType),
      parameters: signature.parameters.map(srmSignatureShape),
      requiredParameterCount: signature.sentinel < 0 ? signature.parameters.length : signature.sentinel };
  }
  if (node.kind === 'modreq' || node.kind === 'modopt') throw new Error('Modifier projection requires a scoped modifier handle');
  if (node.kind === 'array') return { kind: node.kind, element: srmSignatureShape(node.element), rank: node.rank,
    sizes: node.sizes, lowerBounds: node.lowerBounds };
  if (node.element) return { kind: node.kind, element: srmSignatureShape(node.element) };
  throw new Error(`Unrecognized CIL signature shape ${node.kind}`);
}

/** Read a method's actual raw signature into symbolic request shapes; no MethodSpec or execution service is implemented here. */
export function methodSignatureShape(node, scope) {
  if (node.kind === 'primitive') return { kind: 'intrinsic', name: cliSystemName(node.name) };
  if (node.kind === 'genericParameter') {
    const shape = scope[`${node.scope}Arguments`]?.[node.index];
    assert.ok(shape, 'The native method observation must supply its exact generic environment');
    return canonicalNativeShape(shape);
  }
  if (node.kind === 'functionPointer') return { kind: node.kind, returnType: methodSignatureShape(node.signature.returnType, scope),
    parameters: node.signature.parameters.map(parameter => methodSignatureShape(parameter, scope)) };
  if (node.element) return { kind: node.kind, element: methodSignatureShape(node.element, scope),
    ...(['array', 'szarray'].includes(node.kind) ? { rank: node.rank ?? 1 } : {}) };
  throw new Error(`The native method corpus needs an explicit projection for ${node.kind}`);
}
