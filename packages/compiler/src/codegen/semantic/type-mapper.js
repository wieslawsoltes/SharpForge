import {
  isNullableType
} from '../../conversions/nullable.js';
import {
  sourceNullableElement
} from '@sharpforge/bytecode';
import {
  numericTypeId,
  exceptionBaseType
} from '@sharpforge/bytecode';
import {
  exceptionTypeName
} from '../../symbols/exception-identity.js';
/**
 * Maps type symbols to image type names. The bytecode image knows all numeric scalar widths, `bool`, `string`, `object`,
 * `Exception`, framework registry types, classes declared in the image and single-dimensional arrays of those.
 * Rectangular arrays and managed references retain their storage shapes.
 * Everything else either lowers to one of them (enums to `int`, delegate types to a synthesized class) or is
 * reported as not executable on this runtime.
 */
import {
  TypeKind,
  ArrayTypeSymbol
} from '../../symbols/types.js';
import {
  unsupported
} from './unsupported.js';

const specialNames = Object.freeze({
  System_SByte: 'sbyte',
  System_Byte: 'byte',
  System_Int16: 'short',
  System_UInt16: 'ushort',
  System_UInt32: 'uint',
  System_Int64: 'long',
  System_UInt64: 'ulong',
  System_Char: 'char',
  System_Single: 'float',
  System_Decimal: 'decimal',
  System_IntPtr: 'nint',
  System_UIntPtr: 'nuint',
  System_TypedReference: 'typedref',
  System_ArgIterator: 'System.ArgIterator',
  System_RuntimeArgumentHandle: 'System.RuntimeArgumentHandle',
  System_RuntimeTypeHandle: 'System.RuntimeTypeHandle',
  System_Int32: 'int',
  System_Double: 'double',
  System_Boolean: 'bool',
  System_String: 'string',
  System_Object: 'object',
  System_Void: 'void',
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
    // In a generic body the type is closed through the substitution of the construction being lowered; the result
    // of an open type depends on that substitution, so it is not cached under the open symbol.
    const closed = this.host.generics.close(type);
    if (closed !== type) return this.compute(closed, syntax);
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
    // A dynamic value is an object; what is done with it is late bound and reported there (lowering/dynamic.js).
    if (type.typeKind === TypeKind.Dynamic) return 'object';
    if (type.typeKind === TypeKind.Pointer) return this.imageType(type.pointedAtType, syntax) + '*';
    if (isNullableType(type)) return 'System.Nullable`1<' + this.imageType(type.nullableUnderlyingType, syntax) + '>';
    const special = type.specialType;
    if (special && specialNames[special]) return specialNames[special];
    if (type.isErrorType?.()) unsupported('a type the framework registry does not list', syntax);
    const exceptionName = exceptionTypeName(type);
    if (exceptionBaseType(exceptionName)) return exceptionName;
    const core = this.host.analysis.core,
      definition = type.originalDefinition;
    if ([core.span, core.readOnlySpan].includes(definition) && type.typeArguments?.length === 1)
      return 'System.' + (definition === core.span ? 'Span' : 'ReadOnlySpan') + '<' + this.imageType(type.typeArguments[0].type, syntax) + '>';
    const sequences = [core.ienumerableT, core.ienumeratorT, core.iasyncEnumerableT, core.iasyncEnumeratorT];
    if (sequences.includes(definition) && type.typeArguments?.length === 1)
      return this.host.iterators.classOf(this.imageType(type.typeArguments[0].type, syntax)).record.name;
    // A ValueTask is the runtime's task object: the image has no struct to wrap it in.
    if (type === core.valueTask) return this.imageType(core.task, syntax);
    if (definition === core.valueTaskT) return this.imageType(core.taskT.construct(type.typeArguments[0].type), syntax);
    // The non-generic forms enumerate objects.
    if (type === core.ienumerable || type === core.ienumerator) return this.host.iterators.classOf('object').record.name;
    if (this.host.tuples.handles(type)) return this.host.tuples.classOf(type, syntax).record.name;
    if (this.host.anonymous.handles(type)) return this.host.anonymous.classOf(type, syntax).record.name;
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
        if (this.host.isSource(type)) return this.host.classOf(type, syntax).name;
        break;
      case TypeKind.Interface:
        if (this.host.isSource(type)) return this.host.classOf(type, syntax).name;
        break;
      case TypeKind.Class:
        if (this.host.isSource(type)) return this.host.classOf(type, syntax).name;
        break;
      default:
        break;
    }
    // A framework generic over a type the registry does not list shares the construction over `object` (lowering/generics).
    const registry = this.host.bridge.registryName(type) ?? this.host.frameworkConstructions.imageTypeOf(type);
    if (registry) return registry;
    const missing = this.host.frameworkConstructions.missingContract(type);
    if (missing) return unsupported(`type '${type.toDisplayString()}' (the framework registry has no '${missing}' contracts)`, syntax);
    return unsupported(`type '${type.toDisplayString()}' (not in the framework registry)`, syntax);
  }
  /** True when values of the image type are references (cleared at scope exit, comparable with null). */
  isReference(imageType) {
    return !sourceNullableElement(imageType) && !this.host.program.typesByName.get(imageType)?.valueType && imageType !== 'bool' && numericTypeId(
      imageType) === undefined;
  }
}
