/** Maps semantic scalar, array, Span, framework and source symbols to runtime image type names. */
import { TypeKind, ArrayTypeSymbol } from '../../symbols/types.js';
import {isReference} from '../../type-utils.js';
import { unsupported } from './unsupported.js';

const specialNames = Object.freeze({
  System_Int32: 'int', System_UInt32: 'uint', System_Int64: 'long', System_UInt64: 'ulong',
  System_Byte: 'byte', System_SByte: 'sbyte', System_Int16: 'short', System_UInt16: 'ushort', System_Char: 'char',
  System_Double: 'double', System_Single: 'float', System_Decimal: 'decimal',
  System_IntPtr: 'nint', System_UIntPtr: 'nuint', System_Boolean: 'bool',
  System_String: 'string', System_Object: 'object', System_Void: 'void',
});

export class TypeMapper {
  /**
   * @param {object} host `{bridge, classOf(type), delegateClassOf(type)}`: the registry bridge and the image classes
   *   of source classes and delegate types
   */
  constructor(host) {
    this.host = host;
    this.cache = new Map();
  }
  /** The image type name of a type symbol; raises `UnsupportedConstruct` for types the runtime cannot represent. */
  imageType(type, syntax = null) {
    if (!type) return 'object';
    let name = this.cache.get(type);
    if (name === undefined) {
      name = this.compute(type, syntax);
      this.cache.set(type, name);
    }
    return name;
  }
  compute(type, syntax) {
    if (type instanceof ArrayTypeSymbol) {
      return this.imageType(type.elementType, syntax) + '[' + ','.repeat(type.rank - 1) + ']';
    }
    const special = type.specialType;
    if (special && specialNames[special]) return specialNames[special];
    if (type.isErrorType?.()) unsupported('a type the framework registry does not list', syntax);
    const core = this.host.analysis.core,
      definition = type.originalDefinition;
    if (definition === core.span || definition === core.readOnlySpan) {
      const name = definition === core.span ? 'Span' : 'ReadOnlySpan';
      return 'System.' + name + '`1<' + this.imageType(type.typeArguments[0].type, syntax) + '>';
    }
    if ((definition === core.ienumerableT || definition === core.ienumeratorT) && type.typeArguments?.length === 1)
      return this.host.iterators.classOf(this.imageType(type.typeArguments[0].type, syntax)).record.name;
    if (type.typeKind === TypeKind.Class && !this.host.isSource(type)) {
      for (let base = type, depth = 0; base && depth < 64; base = base.baseType, depth++) {
        if (base === core.exception) return type.toDisplayString();
      }
    }
    switch (type.typeKind) {
      case TypeKind.Enum:
        if (this.host.isSource(type)) return 'int';
        break;
      case TypeKind.Delegate:
        return this.host.delegateClassOf(type, syntax).record.name;
      case TypeKind.TypeParameter:
        unsupported('user-defined generics', syntax);
        break;
      case TypeKind.Struct:
        if (this.host.isSource(type)) unsupported('struct types', syntax);
        break;
      case TypeKind.Interface:
        if (this.host.isSource(type)) unsupported('interface dispatch', syntax);
        break;
      case TypeKind.Class:
        if (this.host.isSource(type)) return this.host.classOf(type, syntax).name;
        break;
      default:
        break;
    }
    if (type.originalDefinition?.specialType === 'System_Nullable_T') unsupported('nullable value types', syntax);
    const registry = this.host.bridge.registryName(type);
    if (registry) return registry;
    return unsupported(`type '${type.toDisplayString()}' (not in the framework registry)`, syntax);
  }
  /** True when values of the image type are references (cleared at scope exit, comparable with null). */
  isReference(imageType) {
    return isReference(imageType);
  }
}
