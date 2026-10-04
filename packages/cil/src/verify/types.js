import { CilError } from '../binary.js';

export const VerificationKind = Object.freeze({
  Int32: 'int32', Int64: 'int64', NativeInt: 'nativeInt', Float: 'float', Null: 'null',
  Object: 'object', Boxed: 'boxed', Value: 'value', ManagedPointer: 'managedPointer',
  ReadonlyPointer: 'readonlyPointer', UninitializedThis: 'uninitializedThis', TypedReference: 'typedReference',
});

export const verificationDiagnosticCatalog = Object.freeze({
  CILV0001: 'Invalid verification type or stack',
  CILV0002: 'Incompatible verification stack states',
  CILV0003: 'Verification metadata relation is unavailable',
  CILV0004: 'Verification stack limit exceeded',
  CILV0005: 'Verification merge cancelled',
  CILV0006: 'Invalid verification metadata relation result',
});

export function verificationError(code, message = verificationDiagnosticCatalog[code]) {
  const error = new CilError(message);
  error.code = code;
  return error;
}

class VerificationValue {
  #brand;
  constructor(kind, type) {
    this.kind = kind;
    this.type = type;
    Object.freeze(this);
  }
  static is(value) { return typeof value === 'object' && value !== null && #brand in value; }
}

const scalarKinds = Object.freeze([
  VerificationKind.Int32, VerificationKind.Int64, VerificationKind.NativeInt,
  VerificationKind.Float, VerificationKind.Null, VerificationKind.TypedReference,
]);
const scalarValues = Object.freeze(Object.fromEntries(scalarKinds.map(kind => [kind, new VerificationValue(kind, null)])));
const nominalKinds = Object.freeze([
  VerificationKind.Object, VerificationKind.Boxed, VerificationKind.Value, VerificationKind.ManagedPointer,
  VerificationKind.ReadonlyPointer, VerificationKind.UninitializedThis,
]);

/** Immutable stack type. Nominal types use caller-owned canonical object identities, never names or tokens alone. */
export function verificationType(kind, type = null) {
  if (typeof kind !== 'string') throw verificationError('CILV0001');
  if (Object.hasOwn(scalarValues, kind) && type === null) return scalarValues[kind];
  if (!nominalKinds.includes(kind) || type === null || typeof type !== 'object') {
    throw verificationError('CILV0001');
  }
  return new VerificationValue(kind, type);
}

export function requireVerificationType(value, code = 'CILV0001') {
  if (!VerificationValue.is(value)) throw verificationError(code);
}

export function sameVerificationType(left, right) {
  return left.kind === right.kind && left.type === right.type;
}

export function isReference(value) {
  return value.kind === VerificationKind.Object || value.kind === VerificationKind.Boxed;
}

export function isManagedPointer(value) {
  return value.kind === VerificationKind.ManagedPointer || value.kind === VerificationKind.ReadonlyPointer;
}
