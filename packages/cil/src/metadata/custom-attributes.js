import { Writer, utf8 } from '../binary.js';
import { AttributeContext, AttributeError } from './custom-attribute-types.js';

const ranges = new Map([
  [4, [-128, 127, 'u8']], [5, [0, 255, 'u8']], [6, [-32768, 32767, 'u16']], [7, [0, 65535, 'u16']],
  [8, [-2147483648, 2147483647, 'u32']], [9, [0, 4294967295, 'u32']],
]);

class AttributeWriter {
  constructor(context) {
    this.context = context;
    this.writer = new Writer();
  }

  string(value) {
    if (value === null) return this.writer.u8(0xff);
    if (typeof value !== 'string' || !value.isWellFormed()) throw new AttributeError('MD0110', 'Expected a well-formed string or null');
    // Reject oversized UTF-16 input before allocating its UTF-8 representation.
    this.context.size(value.length, this.context.maxStringBytes);
    const bytes = utf8(value);
    this.context.size(bytes.length, this.context.maxStringBytes);
    const prefix = bytes.length < 0x80 ? 1 : bytes.length < 0x4000 ? 2 : 4;
    this.context.size(this.writer.length + bytes.length + prefix);
    return this.writer.compressed(bytes.length).bytes(bytes);
  }

  primitive(code, value) {
    const writer = this.writer;
    if (code === 14) return this.string(value);
    if (code === 2) {
      if (typeof value !== 'boolean') throw new AttributeError('MD0110', 'Expected a Boolean');
      return writer.u8(value ? 1 : 0);
    }
    if (code === 3) {
      if (typeof value !== 'string' || value.length !== 1) throw new AttributeError('MD0110', 'Expected one UTF-16 character');
      return writer.u16(value.charCodeAt(0));
    }
    if (code === 10 || code === 11) {
      if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw new AttributeError('MD0110', 'Expected an exact 64-bit integer');
      const integer = BigInt(value);
      const signed = code === 10;
      if (integer < (signed ? -(1n << 63n) : 0n) || integer > (1n << (signed ? 63n : 64n)) - 1n) {
        throw new AttributeError('MD0110', 'Integer is outside its attribute type range');
      }
      return writer.i64(BigInt.asIntN(64, integer));
    }
    if (code === 12 || code === 13) {
      if (typeof value !== 'number') throw new AttributeError('MD0110', 'Expected a floating-point number');
      return code === 12 ? writer.f32(value) : writer.f64(value);
    }
    const range = ranges.get(code);
    if (!range || !Number.isInteger(value) || value < range[0] || value > range[1]) throw new AttributeError('MD0110');
    return writer[range[2]](value);
  }

  type(type, depth = 0) {
    this.context.check(depth);
    this.writer.u8(type.code);
    if (type.code === 0x55) this.string(type.type);
    if (type.code === 0x1d) this.type(type.element, depth + 1);
  }

  value(type, value, depth = 0) {
    this.context.check(depth);
    this.context.size(this.writer.length);
    if (type.code === 0x50) return this.string(value);
    if (type.code === 0x55) return this.primitive(type.underlying, value);
    if (type.code === 0x51) {
      const boxed = value === null ? { type: 'string', value: null } : value;
      if (!boxed || typeof boxed !== 'object' || !Object.hasOwn(boxed, 'value')) throw new AttributeError('MD0110');
      const actual = this.context.descriptor(boxed.type, depth + 1);
      if (actual.code === 0x51) throw new AttributeError('MD0103', 'A boxed value requires a concrete type');
      this.type(actual, depth + 1);
      return this.value(actual, boxed.value, depth + 1);
    }
    if (type.code === 0x1d) {
      if (value === null) return this.writer.u32(0xffffffff);
      if (!Array.isArray(value)) throw new AttributeError('MD0110', 'Expected an array or null');
      this.context.size(value.length, this.context.maxArrayLength);
      this.writer.u32(value.length);
      for (const element of value) this.value(type.element, element, depth + 1);
      return;
    }
    return this.primitive(type.code, value);
  }
}

/** Encode fixed values and named {name,isField,type,value} arguments; invalid input throws a coded CilError. */
export function encodeCustomAttribute(parameterTypes, values, namedArguments = [], options = {}) {
  const context = new AttributeContext(options);
  context.check();
  const parameters = context.parameters(parameterTypes);
  if (!Array.isArray(values) || values.length !== parameters.length || !Array.isArray(namedArguments)) throw new AttributeError('MD0100');
  context.size(namedArguments.length, 65535);
  const state = new AttributeWriter(context);
  state.writer.u16(1);
  for (let index = 0; index < parameters.length; index++) state.value(parameters[index], values[index]);
  state.writer.u16(namedArguments.length);
  for (const argument of namedArguments) {
    if (!argument || typeof argument.name !== 'string' || !argument.name || typeof argument.isField !== 'boolean') {
      throw new AttributeError('MD0105');
    }
    const type = context.descriptor(argument.type);
    state.writer.u8(argument.isField ? 0x53 : 0x54);
    state.type(type);
    state.string(argument.name);
    state.value(type, argument.value);
  }
  context.size(state.writer.length);
  return state.writer.finish();
}
