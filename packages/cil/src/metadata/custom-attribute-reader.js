import { Reader, text } from '../binary.js';
import { readPrimitiveValue } from './primitive-values.js';
import { AttributeContext, AttributeError, attributePrimitiveName } from './custom-attribute-types.js';

const constant = (kind, type, value) => Object.freeze({ kind, type, value });

export class AttributeReader {
  constructor(bytes, context) {
    if (!(bytes instanceof Uint8Array)) throw new AttributeError('MD0100');
    context.size(bytes.length);
    this.reader = new Reader(bytes);
    this.context = context;
  }

  string() {
    const reader = this.reader;
    if (reader.bytes[reader.position] === 0xff) {
      reader.u8();
      return null;
    }
    const size = this.context.size(reader.compressed(), this.context.maxStringBytes);
    const bytes = reader.take(size);
    try { return text(bytes); }
    catch { throw new AttributeError('MD0110', 'Invalid UTF-8 custom attribute string', reader.position - size); }
  }

  type(depth = 0, element = false) {
    this.context.check(depth);
    const code = this.reader.u8();
    if (code === 28) throw new AttributeError('MD0103', 'Named object arguments require the serialized object tag');
    if (code === 0x55) return this.context.enumType(this.string());
    if (code === 0x1d) {
      if (element) throw new AttributeError('MD0103', 'Jagged custom attribute arrays are invalid');
      return { code, element: this.type(depth + 1, true) };
    }
    return this.context.descriptor({ code }, depth);
  }

  value(type, depth = 0) {
    this.context.check(depth);
    const { code } = type;
    if (code === 0x51) {
      const actual = this.type(depth + 1);
      if (actual.code === 0x51) throw new AttributeError('MD0103', 'A boxed value requires a concrete type');
      return this.value(actual, depth + 1);
    }
    if (code === 0x50) return constant('type', 'System.Type', this.string());
    if (code === 0x55) return constant('enum', type.type, readPrimitiveValue(this.reader, type.underlying));
    if (code === 0x1d) {
      const length = this.reader.u32();
      if (length === 0xffffffff) return constant('array', null, null);
      this.context.size(length, this.context.maxArrayLength);
      if (length > this.reader.end - this.reader.position) throw new AttributeError('MD0102');
      const values = [];
      for (let index = 0; index < length; index++) values.push(this.value(type.element, depth + 1));
      return constant('array', null, Object.freeze(values));
    }
    return constant('primitive', attributePrimitiveName(code), code === 14 ? this.string() : readPrimitiveValue(this.reader, code));
  }

  read(parameters) {
    const reader = this.reader;
    if (reader.u16() !== 1) throw new AttributeError('MD0101', undefined, 0);
    const constructorArguments = parameters.map(type => this.value(type));
    return { constructorArguments, namedArguments: this.namedArguments(reader.u16()) };
  }

  /** Shared named-argument grammar; permission sets use a compressed count instead of the attribute UInt16. */
  namedArguments(count) {
    const reader = this.reader;
    if (count > reader.end - reader.position) throw new AttributeError('MD0102');
    const namedArguments = [];
    for (let index = 0; index < count; index++) {
      const tag = reader.u8();
      if (tag !== 0x53 && tag !== 0x54) throw new AttributeError('MD0105', undefined, reader.position - 1);
      const type = this.type();
      const name = this.string();
      if (!name) throw new AttributeError('MD0105', 'Named arguments require a nonempty name');
      namedArguments.push(Object.freeze({ name, isField: tag === 0x53, value: this.value(type) }));
    }
    if (reader.position !== reader.end) throw new AttributeError('MD0107', undefined, reader.position);
    return namedArguments;
  }
}

/** Decode typed values or stable MD diagnostics; malformed blobs never escape as exceptions. */
export function decodeCustomAttribute(bytes, parameterTypes = [], options = {}) {
  let state;
  try {
    const context = new AttributeContext(options);
    context.check();
    const parameters = context.parameters(parameterTypes);
    state = new AttributeReader(bytes, context);
    return { success: true, ...state.read(parameters), diagnostics: [] };
  } catch (error) {
    const message = error?.message ?? String(error);
    const code = error instanceof AttributeError ? error.code : /Truncated/.test(message) ? 'MD0102' : 'MD0100';
    const diagnostic = { code, severity: 'error', message, offset: error?.offset ?? state?.reader.position ?? 0 };
    return { success: false, constructorArguments: [], namedArguments: [], diagnostics: [diagnostic] };
  }
}
