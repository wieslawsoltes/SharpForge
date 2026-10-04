import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {genericTypeParts, normalizeCallType} from './generic-signatures.js';
import {verifyGenericType} from './generic-profile.js';

const scalars = new Set([
  'bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'float', 'double', 'decimal', 'System.Decimal', 'nint', 'nuint'
]);
const references = new Set([
  'object', 'string', 'Exception', 'System.Exception', 'System.Array', 'System.ValueType', 'System.Enum',
  'System.Type', 'System.Reflection.MemberInfo', 'System.Delegate', 'System.MulticastDelegate'
]);

/** Admission uses existing symbolic generic validation; layout is resolved only in a closed executing frame. */
export class SizeOfProfile {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.name, type]));
  }

  category(input, depth = 0) {
    if (depth > 64) throw new CilError('sizeof type nesting limit exceeded');
    const name = normalizeCallType(input);
    if (/^!!?\d+$/.test(name)) return 'parameter';
    if (name === 'void' || name === 'typedref' || name === 'System.TypedReference' || /[&*]$/.test(name) ||
        name.startsWith('method ')) {
      throw new CilError('sizeof requires a supported value, reference or declared generic parameter');
    }
    const array = /^(.*)\[[^\[\]]*\]$/.exec(name);
    if (array) {
      this.category(array[1], depth + 1);
      return 'reference';
    }
    if (scalars.has(name)) return 'value';
    const parts = genericTypeParts(name);
    const arguments_ = parts.arguments.map(argument => this.category(argument, depth + 1));
    if (/`\d+$/.test(parts.definition) && !arguments_.length) {
      throw new CilError('sizeof requires a complete generic type instantiation');
    }
    if (parts.definition === 'System.Nullable`1') {
      if (arguments_[0] === 'reference' || arguments_[0] === 'nullable') {
        throw new CilError('sizeof Nullable requires a non-nullable value argument');
      }
      return 'nullable';
    }
    const definition = this.types.get(parts.definition);
    if (definition) {
      const base = definition.baseToken ? this.inspector.metadata.typeName(definition.baseToken) : null;
      return base === 'System.ValueType' || base === 'System.Enum' ? 'value' : 'reference';
    }
    const framework = frameworkType(name);
    if (framework?.kind === 'enum') return 'value';
    if (references.has(name) || framework && framework.kind !== 'value') return 'reference';
    throw new CilError('sizeof external type layout is not implemented: ' + name);
  }

  verify(method, instruction, context, issue) {
    let operand;
    try {
      operand = this.inspector.resolveToken(instruction.operand);
      if (operand.kind !== 'type') throw new CilError('sizeof requires a type token');
    } catch (error) {
      issue(method, instruction, 'IL_TOKEN', error.message);
      return;
    }
    try {
      verifyGenericType(this.inspector, operand.name, context);
      this.category(operand.name);
    } catch (error) {
      issue(method, instruction, 'IL_TYPE', 'sizeof: ' + error.message);
    }
  }
}
