import {int64Compare, uint32Compare, smallInteger} from '@sharpforge/bytecode';

/** Select an unsigned extremum while retaining the original canonical I4/I8 stack value. */
export function unsignedMathExtremum(name, type, left, right) {
  let order;
  if (type === 'uint') order = uint32Compare(left, right);
  else if (type === 'ulong') order = int64Compare(left, right, true);
  else throw new TypeError('Unsigned Math extremum requires UInt32 or UInt64');

  if (name === 'Min') return order <= 0 ? left : right;
  if (name === 'Max') return order >= 0 ? left : right;
  throw new TypeError('Unsigned Math extremum requires Min or Max');
}

/** Normalize both declared 8/16-bit parameters, then return the selected I4 value. */
export function smallMathExtremum(name, type, left, right) {
  if (type !== 'sbyte' && type !== 'byte' && type !== 'short' && type !== 'ushort') {
    throw new TypeError('Small Math extremum requires SByte, Byte, Int16 or UInt16');
  }
  left = smallInteger(left, type);
  right = smallInteger(right, type);
  if (name === 'Min') return left <= right ? left : right;
  if (name === 'Max') return left >= right ? left : right;
  throw new TypeError('Small Math extremum requires Min or Max');
}
