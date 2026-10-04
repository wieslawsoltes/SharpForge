import { Writer } from '@sharpforge/cil';
import { MetadataEmitError } from './type-tokens.js';

const utf8 = new TextEncoder();
const DEFAULT_ELEMENT = 0x50;

function integer(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 0x1fffffff) {
    throw new MetadataEmitError(`the MarshalAs ${label} is not a valid compressed unsigned integer`);
  }
  return result;
}

function packedString(writer, value) {
  const bytes = utf8.encode(value ?? '');
  writer.compressed(bytes.length).bytes(bytes);
}

/** ECMA-335 II.23.4 native storage descriptor, including the optional array and marshaler tails. */
export function marshalDescriptor(nativeType, named) {
  const type = integer(nativeType, 'unmanaged type'), writer = new Writer().u8(type);
  const number = (name, fallback) => Object.hasOwn(named, name) ? integer(named[name], name) : fallback;
  switch (type) {
    case 23: // ByValTStr
      writer.compressed(number('SizeConst', 0));
      break;
    case 30: // ByValArray
      writer.compressed(number('SizeConst', 0));
      if (Object.hasOwn(named, 'ArraySubType')) writer.compressed(number('ArraySubType'));
      break;
    case 42: { // LPArray always carries an element type; 0x50 lets the marshaler infer it.
      writer.compressed(number('ArraySubType', DEFAULT_ELEMENT));
      const parameter = number('SizeParamIndex', -1), count = number('SizeConst', -1);
      if (parameter >= 0) {
        writer.compressed(parameter);
        if (count >= 0) writer.compressed(count).compressed(1);
      } else if (count >= 0) writer.compressed(0).compressed(count).compressed(0);
      break;
    }
    case 25: case 26: case 28: // IUnknown, IDispatch, Interface
      if (Object.hasOwn(named, 'IidParameterIndex')) writer.compressed(number('IidParameterIndex'));
      break;
    case 29: // SafeArray
      if (Object.hasOwn(named, 'SafeArraySubType')) writer.compressed(number('SafeArraySubType'));
      if (named.SafeArrayUserDefinedSubType != null) packedString(writer, named.SafeArrayUserDefinedSubType);
      break;
    case 44: // CustomMarshaler: reserved GUID and native type name, managed type name, cookie.
      writer.u16(0);
      packedString(writer, named.MarshalTypeRef ?? named.MarshalType);
      packedString(writer, named.MarshalCookie);
      break;
  }
  return writer.finish();
}
