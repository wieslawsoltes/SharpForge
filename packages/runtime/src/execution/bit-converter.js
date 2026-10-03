import {singleToInt32Bits, doubleToInt64Bits, int32BitsToSingle, int64BitsToDouble} from '@sharpforge/bytecode';

const operations = Object.freeze({
  SingleToInt32Bits: singleToInt32Bits,
  DoubleToInt64Bits: doubleToInt64Bits,
  Int32BitsToSingle: int32BitsToSingle,
  Int64BitsToDouble: int64BitsToDouble
});

/** Dispatch only after the shared CIL registry has matched the complete signature. */
export function invokeBitConverter(descriptor, parameters) {
  return operations[descriptor.name](parameters[0]);
}
