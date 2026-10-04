import {int64Compare, uint32Compare} from '@sharpforge/bytecode';

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
