import {number, storage} from './numeric-ops.js';

const accessors = new Map([
  ['System.Boolean', 'Uint8'], ['System.SByte', 'Int8'], ['System.Byte', 'Uint8'],
  ['System.Char', 'Uint16'], ['System.Int16', 'Int16'], ['System.UInt16', 'Uint16'],
  ['System.Int32', 'Int32'], ['System.UInt32', 'Uint32'], ['System.Int64', 'BigInt64'],
  ['System.UInt64', 'BigUint64'], ['System.Single', 'Float32'], ['System.Double', 'Float64']
]);

/** Scalar storage only; no host pointers or managed references become byte payloads. */
export function scalarAccess(table) {
  if (table.enumUnderlyingType) return scalarAccess(table.enumUnderlyingType);
  if (table.name === 'System.IntPtr' || table.name === 'System.UIntPtr') {
    return (table.registry.nativeIntBits === 64 ? 'Big' : '') +
      (table.name === 'System.UIntPtr' ? 'Uint' : 'Int') + table.registry.nativeIntBits;
  }
  return accessors.get(table.name);
}

export function readScalarBytes(vm, view, offset, table) {
  return storage(view['get' + scalarAccess(table)](offset, true),
    table.enumUnderlyingType?.name ?? table.name, vm.options);
}

export function writeScalarBytes(view, offset, value, table) {
  const access = scalarAccess(table);
  let raw = number(value);
  if (access.startsWith('Big')) raw = BigInt(raw);
  view['set' + access](offset, typeof raw === 'boolean' ? Number(raw) : raw, true);
}
