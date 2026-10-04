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

/** Internal storage lookup accepts only the decoder's existing canonical primitive nodes. */
export function primitiveVerificationSlot(type) {
  if (type?.kind !== 'primitive' || !Object.hasOwn(primitives, type.name)) return null;
  return signaturePrimitiveNodes[type.name] === type ? primitives[type.name] : null;
}

export function primitiveStorageSlot(type) {
  const direct = primitiveVerificationSlot(type);
  if (direct) return direct;
  const element = type.kind === 'byref' ? primitiveVerificationSlot(type.element) : null;
  if (element) {
    return Object.freeze({ type: element.type, value: element.address, address: null, byref: true });
  }
  return null;
}

export function knownMetadata(result, fail) {
  if (result.status === 'unknown') fail('MetadataUnavailable', result.reason, true);
  return result.value;
}

/** Storage representations retain existing canonical type handles; unsupported normalization stays unknown. */
export function nominalStorageSlot(node, types, fail) {
  const byref = node.kind === 'byref';
  const type = byref ? node.element : node;
  if (type.kind !== 'class' && type.kind !== 'valuetype')
    fail('UnsupportedSignature', 'Nominal storage requires a local class or non-enum value type', true);
  const identity = knownMetadata(types.resolveType(type.token), fail);
  const category = knownMetadata(types.typeCategory(identity), fail);
  if (category === 'enum') fail('EnumStorageUnavailable', 'Enum storage normalization is not implemented', true);
  if ((category === 'reference') !== (type.kind === 'class')) fail('ClassValueTypeMismatch');
  const address = verificationType(Kind.ManagedPointer, identity);
  const value = byref ? address : verificationType(category === 'reference' ? Kind.Object : Kind.Value, identity);
  return Object.freeze({ type: identity, value, address: byref ? null : address, byref });
}
