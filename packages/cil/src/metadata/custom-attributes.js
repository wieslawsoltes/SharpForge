import { Writer, utf8 } from '../binary.js';
import { writePrimitiveValue } from './primitive-values.js';
import { AttributeContext, AttributeError } from './custom-attribute-types.js';

const invalidAttributeValue = message => new AttributeError('MD0110', message);
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
    if (code === 14) return this.string(value);
    return writePrimitiveValue(this.writer, code, value, invalidAttributeValue);
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
