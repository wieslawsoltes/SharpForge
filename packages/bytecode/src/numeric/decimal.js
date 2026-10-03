/** Public Decimal value-kind seam. Arithmetic is exact; scale and sign survive storage. */
export {
  decimalMaxCoefficient, isDecimal, decimal, decimalZero, decimalFromBits, decimalBits,
  decimalParse, decimalFromInteger, decimalFromFloat, decimalToInteger, decimalToFloat,
  decimalCompare, decimalNegate, decimalAbs, decimalAdd, decimalMultiply, decimalDivide,
  decimalRemainder, decimalRound, decimalFormat, decimalBinary,
} from './decimal-ops.js';
