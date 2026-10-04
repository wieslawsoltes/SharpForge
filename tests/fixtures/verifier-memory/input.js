import { managedFixture } from '../../managed-fixtures.js';

function load(name, element, opcode, result, options = {}) {
  return { name, parameters: [element + '&'], result, status: 'verified', ...options,
    body: writer => writer.op('ldarg.0').op(opcode).op('ret') };
}

function store(name, element, value, opcode, options = {}) {
  return { name, parameters: [element + '&', value], status: 'verified', ...options,
    body: writer => writer.op('ldarg.0').op('ldarg.1').op(opcode).op('ret') };
}

const nativeAssignment = 'ILVerify rejects the int32/native-int stack assignment permitted by ECMA I.8.7.3 rule 4.';
const unresolvedShape = 'Cross-width pointer access remains unknown: intermediate equality does not prove storage extent.';
const unresolvedReference = 'stind.ref on a non-reference pointee remains unknown; native acceptance does not resolve pointer consistency.';

// Independently authored storage/opcode cases; this file never reads the product policy table.
export const memoryCases = [
  load('LoadBoolean', 'bool', 'ldind.i1', 'int'),
  load('LoadSignedByte', 'sbyte', 'ldind.i1', 'int'),
  load('LoadUnsignedByte', 'byte', 'ldind.u1', 'int'),
  load('LoadSignedOpcodeByte', 'byte', 'ldind.i1', 'int'),
  load('LoadUnsignedOpcodeSByte', 'sbyte', 'ldind.u1', 'int'),
  load('LoadCharacter', 'char', 'ldind.u2', 'int'),
  load('LoadShort', 'short', 'ldind.i2', 'int'),
  load('LoadUnsignedShort', 'ushort', 'ldind.u2', 'int'),
  load('LoadInteger', 'int', 'ldind.i4', 'int'),
  load('LoadUnsignedInteger', 'uint', 'ldind.u4', 'int'),
  load('LoadLong', 'long', 'ldind.i8', 'long'),
  load('LoadUnsignedLong', 'ulong', 'ldind.i8', 'long'),
  load('LoadNative', 'nint', 'ldind.i', 'nint'),
  load('LoadUnsignedNative', 'nuint', 'ldind.i', 'nint'),
  load('LoadSingle', 'float', 'ldind.r4', 'float'),
  load('LoadDouble', 'double', 'ldind.r8', 'double'),
  load('LoadObject', 'object', 'ldind.ref', 'object'),
  load('LoadString', 'string', 'ldind.ref', 'string'),
  store('StoreBoolean', 'bool', 'int', 'stind.i1'),
  store('StoreByte', 'byte', 'int', 'stind.i1'),
  store('StoreSignedByte', 'sbyte', 'int', 'stind.i1'),
  store('StoreCharacter', 'char', 'int', 'stind.i2'),
  store('StoreShort', 'short', 'int', 'stind.i2'),
  store('StoreUnsignedShort', 'ushort', 'int', 'stind.i2'),
  store('StoreInteger', 'int', 'int', 'stind.i4'),
  store('StoreUnsignedInteger', 'uint', 'int', 'stind.i4'),
  store('StoreLong', 'long', 'long', 'stind.i8'),
  store('StoreUnsignedLong', 'ulong', 'long', 'stind.i8'),
  store('StoreNative', 'nint', 'nint', 'stind.i'),
  store('StoreUnsignedNative', 'nuint', 'nint', 'stind.i'),
  store('StoreSingle', 'float', 'double', 'stind.r4'),
  store('StoreDouble', 'double', 'float', 'stind.r8'),
  store('StoreObject', 'object', 'object', 'stind.ref'),
  store('StoreString', 'string', 'string', 'stind.ref'),
  store('StoreStringInObject', 'object', 'string', 'stind.ref'),
  store('StoreObjectInString', 'string', 'object', 'stind.ref', { status: 'rejected' }),
  store('StoreIntegerInLong', 'long', 'int', 'stind.i8', { status: 'rejected' }),
  store('StoreFloatInInteger', 'int', 'double', 'stind.i4', { status: 'rejected' }),
  store('StoreReferenceInInteger', 'int', 'object', 'stind.i4', { status: 'rejected' }),
  store('StoreNativeFromInteger', 'nint', 'int', 'stind.i', { nativeAccepted: false, difference: nativeAssignment }),
  store('StoreIntegerFromNative', 'int', 'nint', 'stind.i4', { nativeAccepted: false, difference: nativeAssignment }),
  load('LoadReferenceFromInteger', 'int', 'ldind.ref', 'object', { status: 'rejected' }),
  load('LoadIntegerFromFloat', 'float', 'ldind.i4', 'int', { status: 'rejected' }),
  load('LoadLongFromInteger', 'int', 'ldind.i8', 'long', { status: 'rejected' }),
  load('LoadWideInteger', 'byte', 'ldind.i4', 'int',
    { status: 'unknown', nativeAccepted: false, difference: unresolvedShape }),
  load('LoadWideFloat', 'float', 'ldind.r8', 'double',
    { status: 'unknown', nativeAccepted: false, difference: unresolvedShape }),
  store('StoreWideInteger', 'byte', 'int', 'stind.i4',
    { status: 'unknown', nativeAccepted: true, difference: unresolvedShape }),
  store('StoreWideFloat', 'float', 'double', 'stind.r8',
    { status: 'unknown', nativeAccepted: true, difference: unresolvedShape }),
  store('StoreReferenceOpcodeInteger', 'int', 'int', 'stind.ref',
    { status: 'unknown', nativeAccepted: true, difference: unresolvedReference }),
  { name: 'StoreNullString', parameters: ['string&'], status: 'verified',
    body: writer => writer.op('ldarg.0').op('ldnull').op('stind.ref').op('ret') },
  { name: 'LocalAddressRoundtrip', locals: ['int'], result: 'int', status: 'verified',
    body: writer => writer.op('ldloca.s', 0).op('ldc.i4.1').op('stind.i4').op('ldloca.s', 0).op('ldind.i4').op('ret') },
  { name: 'ArgumentAddressRoundtrip', parameters: ['int'], result: 'int', status: 'verified',
    body: writer => writer.op('ldarga.s', 0).op('ldc.i4.1').op('stind.i4').op('ldarga.s', 0).op('ldind.i4').op('ret') },
  { name: 'LoadUnmanagedAddress', parameters: ['nint'], result: 'int', status: 'rejected',
    body: writer => writer.op('ldarg.0').op('ldind.i4').op('ret') },
  { name: 'StoreUnmanagedAddress', parameters: ['nint'], status: 'rejected',
    body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('stind.i4').op('ret') },
  { name: 'LoadUnderflow', status: 'rejected', body: writer => writer.op('ldind.i4').op('pop').op('ret') },
  { name: 'StoreUnderflow', parameters: ['int&'], status: 'rejected',
    body: writer => writer.op('ldarg.0').op('stind.i4').op('ret') },
];

export function memoryFixture(fixture) {
  return managedFixture({ name: fixture.name, entry: null, methods: [{ maxStack: 8, ...fixture }] });
}
