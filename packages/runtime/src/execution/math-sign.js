import {number, smallInteger} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';

/** Apply an admitted Math.Sign overload and return its primitive Int32 result. */
export function mathSign(type, input) {
  let value = number(input);
  switch (type) {
    case 'sbyte':
    case 'short':
      value = smallInteger(value, type);
      break;
    case 'float':
      value = Math.fround(value);
      // A Single parameter first rounds the shared CLI floating stack category.
      // Fall through to Double's NaN contract after this width boundary.
    case 'double':
      if (Number.isNaN(value)) {
        throw new ManagedFault('ArithmeticException', 'Function does not accept floating point Not-a-Number values.');
      }
      break;
    case 'int':
    case 'long':
      break;
    default:
      throw new TypeError('Math.Sign requires an admitted signed integer or floating type');
  }
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}
