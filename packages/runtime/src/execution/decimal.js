/** Shared exact Decimal value operations; both execution engines use this representation. */
export {
  decimal, decimalZero, decimalMaxCoefficient, isDecimal, decimalFromBits, decimalBits,
  decimalParse, decimalFromInteger, decimalFromFloat, decimalToInteger, decimalToFloat,
  decimalCompare, decimalNegate, decimalAbs, decimalAdd, decimalMultiply, decimalDivide, decimalRemainder,
  decimalRound, decimalBinary, decimalFormat
} from '@sharpforge/bytecode';
