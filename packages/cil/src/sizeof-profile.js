import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {genericTypeParts} from './field-profile.js';
import {callStorageType, normalizeCallType} from './call-profile.js';

const scalars = new Set([
  'bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'float', 'double', 'decimal', 'nint', 'nuint'
]);
const references = new Set([
  'object', 'string', 'Exception', 'System.Array', 'System.ValueType', 'System.Enum',
  'System.Type', 'System.Reflection.MemberInfo', 'System.Delegate', 'System.MulticastDelegate'
]);

/** Metadata-only sizeof admission; generic operands are closed by the executing frame. */
export class SizeOfProfile {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.name, type]));
    this.parameters = new Map();
    for (const row of inspector.metadata.rows[42] ?? []) {
      const owner = decodeCoded('TypeOrMethodDef', row[2]);
      if (!this.parameters.has(owner)) this.parameters.set(owner, []);
      this.parameters.get(owner).push(row[0]);
    }
  }

  arity(owner) {
    const parameters = this.parameters.get(owner) ?? [];
    if (parameters.some((index, position) => index !== position)) {
      throw new CilError('Invalid generic parameter numbering in sizeof context');
    }
    return parameters.length;
  }

  category(input, method, depth = 0) {
    if (depth > 64) throw new CilError('sizeof type nesting limit exceeded');
    const name = normalizeCallType(callStorageType(input));
    const parameter = /^(!{1,2})(\d+)$/.exec(name);
    if (parameter) {
      const owner = parameter[1] === '!!' ? method.token : method.ownerToken;
      if (Number(parameter[2]) >= this.arity(owner)) throw new CilError('sizeof generic parameter is outside its declaring scope');
      return 'parameter';
    }
    if (name === 'void' || name === 'typedref' || /[&*]$/.test(name) || name.startsWith('method ')) {
      throw new CilError('sizeof requires a value type, reference type or declared generic parameter');
    }
    const array = /^(.*)\[[^\[\]]*\]$/.exec(name);
    if (array) {
      this.category(array[1], method, depth + 1);
      return 'reference';
    }
    if (scalars.has(name)) return 'value';
    const parts = genericTypeParts(name);
    const definition = this.types.get(parts.definition);
    const arity = definition ? this.arity(definition.token) : Number(/`(\d+)$/.exec(parts.definition)?.[1] ?? 0);
    if (arity !== parts.arguments.length) throw new CilError('sizeof requires a complete generic type instantiation');
    const arguments_ = parts.arguments.map(argument => this.category(argument, method, depth + 1));
    if (parts.definition === 'System.Nullable`1') {
      if (arguments_[0] === 'reference' || arguments_[0] === 'nullable') {
        throw new CilError('sizeof Nullable requires a non-nullable value argument');
      }
      return 'nullable';
    }
    if (definition) {
      const base = definition.baseToken ? this.inspector.metadata.typeName(definition.baseToken) : null;
      return base === 'System.ValueType' || base === 'System.Enum' ? 'value' : 'reference';
    }
    const framework = frameworkType(name);
    if (framework?.kind === 'enum') return 'value';
    if (references.has(name) || framework && framework.kind !== 'value') return 'reference';
    throw new CilError('sizeof external type layout is not implemented: ' + name);
  }

  verify(method, instruction, issue) {
    let operand;
    try {
      operand = this.inspector.resolveToken(instruction.operand);
      if (operand.kind !== 'type') throw new CilError('sizeof requires a type token');
    } catch (error) {
      issue(method, instruction, 'IL_TOKEN', error.message);
      return;
    }
    try { this.category(operand.name, method); }
    catch (error) { issue(method, instruction, 'IL_TYPE', error.message); }
  }
}
