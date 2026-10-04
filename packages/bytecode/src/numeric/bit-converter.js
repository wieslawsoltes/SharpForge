import {float} from './float.js';
import {number} from './numeric-values.js';

// The synchronous helpers never expose this scratch view or invoke guest callbacks.
const view = new DataView(new ArrayBuffer(8));

/** Reinterpret a CLI Single payload as signed Int32 bits, without numeric conversion. */
export function singleToInt32Bits(value) {
  view.setFloat32(0, number(value), true);
  return view.getInt32(0, true);
}

/** Reinterpret a CLI Double payload as signed Int64 bits. */
export function doubleToInt64Bits(value) {
  view.setFloat64(0, number(value), true);
  return view.getBigInt64(0, true);
}

/** Decode signed Int32 bits into an immutable Single stack value. */
export function int32BitsToSingle(value) {
  view.setInt32(0, Number(number(value)), true);
  return float(view.getFloat32(0, true), 'r4');
}

/** Decode signed Int64 bits into an immutable Double stack value. */
export function int64BitsToDouble(value) {
  view.setBigInt64(0, BigInt(number(value)), true);
  return float(view.getFloat64(0, true), 'r8');
}
