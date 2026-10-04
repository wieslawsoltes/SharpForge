/** Named scalar helper exports shared by CIL execution and source numeric modes. */
export {float, floatBinary, floatCompare, finiteFloat, ieeeRemainder} from './float.js';
export {int64Binary, int64Compare, int64Unary} from './int64.js';
export {uint32Binary, uint32Compare} from './uint32.js';

export {convert, conversionTargets} from './conversions.js';
export {number, isNumber} from './numeric-values.js';

export {singleToInt32Bits, doubleToInt64Bits, int32BitsToSingle, int64BitsToDouble} from './bit-converter.js';
export {nativeIntegerBits, isNativeInteger, nativeInteger, nativeBinary, nativeSize} from './native-int.js';

export {
  decimal, decimalZero, decimalMaxCoefficient, isDecimal, decimalFromBits, decimalBits,
  decimalParse, decimalFromInteger, decimalFromFloat, decimalToInteger, decimalToFloat,
  decimalCompare, decimalNegate, decimalAbs, decimalAdd, decimalMultiply, decimalDivide, decimalRemainder,
  decimalRound, decimalBinary, decimalFormat
} from './decimal-ops.js';
export {decimalIntrinsicDefinitions, isDecimalConstantField} from '../decimal-intrinsic-profile.js';
export {
  NumericType, numericTypeNames, numericAliases, numericTypeName, numericTypeId,
  numericMode, decodeNumericMode, isNumericMode, integerType
} from './numeric-types.js';
export {encodeScalar,decodeScalar} from './scalar-codec.js';
