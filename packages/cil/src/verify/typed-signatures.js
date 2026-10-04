import { readExecutionSignatureAst } from '../metadata/execution-signature.js';
import { signaturePrimitiveNodes } from '../metadata/signature-types.js';
import { VerificationKind as Kind, verificationType, sameVerificationType } from './types.js';

const primitiveKinds = Object.freeze({
  bool: Kind.Int32, char: Kind.Int32, sbyte: Kind.Int32, byte: Kind.Int32, short: Kind.Int32, ushort: Kind.Int32,
  int: Kind.Int32, uint: Kind.Int32, long: Kind.Int64, ulong: Kind.Int64, nint: Kind.NativeInt, nuint: Kind.NativeInt,
  float: Kind.Float, double: Kind.Float, object: Kind.Object, string: Kind.Object,
});
const primitives = Object.freeze(Object.fromEntries(Object.entries(primitiveKinds).map(([name, kind]) => {
  const type = signaturePrimitiveNodes[name];
  return [name, Object.freeze({ type, value: verificationType(kind, kind === Kind.Object ? type : null),
    address: verificationType(Kind.ManagedPointer, type), byref: false })];
})));

export const primitiveRelations = Object.freeze({
  isAssignableTo(source, target) {
    return sameVerificationType(source, target) || target.type === signaturePrimitiveNodes.object;
  },
  commonSupertype() { return primitives.object.value; },
});

function slot(type, fail) {
  if (type.kind === 'primitive' && Object.hasOwn(primitives, type.name)) return primitives[type.name];
  if (type.kind === 'byref' && type.element.kind === 'primitive' && Object.hasOwn(primitives, type.element.name)) {
    const element = primitives[type.element.name];
    return Object.freeze({ type: element.type, value: element.address, address: null, byref: true });
  }
  fail('UnsupportedSignature', 'Numeric verification requires primitive or primitive-byref storage types', true);
}

/** Decode each lossless AST once; canonical primitive identities preserve address element types. */
export function numericMethodSignature(inspector, method, options, fail) {
  const signature = readExecutionSignatureAst(inspector.metadata, method.token, options);
  if (signature.hasThis || signature.explicitThis || signature.genericArity || signature.callingConvention || signature.sentinel !== -1)
    fail('UnsupportedSignature', 'Instance, generic and vararg method typing requires later verifier policies', true);
  const locals = method.localSignature ? readExecutionSignatureAst(inspector.metadata, method.localSignature, options).types : [];
  const returnType = signature.returnType;
  if (returnType.kind === 'byref') fail('UnsupportedSignature', 'Byref returns require lifetime verification', true);
  return {
    arguments: signature.parameters.map(type => slot(type, fail)),
    locals: locals.map(type => slot(type, fail)),
    result: returnType.kind === 'primitive' && returnType.name === 'void' ? null : slot(returnType, fail).value,
  };
}
