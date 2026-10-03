/**
 * Maps type symbols to image type names. The bytecode image knows `int`, `double`, `bool`, `string`, `object`,
 * `Exception`, framework registry types, classes declared in the image and single-dimensional arrays of those.
 * Everything else either lowers to one of them (enums to `int`, delegate types to a synthesized class) or is
 * reported as not executable on this runtime.
 */
import { TypeKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { unsupported } from './unsupported.js';

const specialNames = Object.freeze({
  System_Int32: 'int',
  System_Double: 'double',
  System_Boolean: 'bool',
  System_String: 'string',
  System_Object: 'object',
  System_Void: 'void',
});
const unsupportedSpecial = Object.freeze({
  System_Char: 'char values',
  System_Int64: '64-bit integers',
  System_UInt64: '64-bit integers',
  System_UInt32: 'unsigned integers',
  System_Byte: 'small integer types',
  System_SByte: 'small integer types',
  System_Int16: 'small integer types',
  System_UInt16: 'small integer types',
  System_Single: 'float values',
  System_Decimal: 'decimal values',
  System_IntPtr: 'native integers',
  System_UIntPtr: 'native integers',
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
      if (type.rank !== 1) unsupported('multi-dimensional arrays', syntax);
      return this.imageType(type.elementType, syntax) + '[]';
    }
    const special = type.specialType;
    if (special && specialNames[special]) return specialNames[special];
    if (special && unsupportedSpecial[special]) unsupported(unsupportedSpecial[special], syntax);
    if (type.isErrorType?.()) unsupported('a type the framework registry does not list', syntax);
    const core = this.host.analysis.core,
      definition = type.originalDefinition;
    if ((definition === core.ienumerableT || definition === core.ienumeratorT) && type.typeArguments?.length === 1)
      return this.host.iterators.classOf(this.imageType(type.typeArguments[0].type, syntax)).record.name;
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
    return !['int', 'double', 'bool'].includes(imageType);
  }
}
