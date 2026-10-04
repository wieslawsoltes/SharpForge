import { TypeKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { MetadataEmitError } from './type-tokens.js';
import { fullNameOf, serializedTypeName } from './serialized-type-names.js';
import { parameterDefaultConstant } from '../../constants/parameter-default.js';

const primitiveNames = Object.freeze({
  System_Boolean: 'bool', System_Char: 'char', System_SByte: 'sbyte', System_Byte: 'byte', System_Int16: 'short', System_UInt16: 'ushort',
  System_Int32: 'int', System_UInt32: 'uint', System_Int64: 'long', System_UInt64: 'ulong', System_Single: 'float', System_Double: 'double',
  System_String: 'string', System_Object: 'object',
});

/** The type of an attribute parameter as `encodeCustomAttribute` describes it. */
export function descriptorOf(type, tokens) {
  if (type instanceof ArrayTypeSymbol) return { kind: 'szarray', element: descriptorOf(type.elementType, tokens) };
  const primitive = primitiveNames[type.specialType];
  if (primitive) return primitive;
  if (type.typeKind === TypeKind.Enum) {
    return { kind: 'enum', name: serializedTypeName(type, tokens), underlying: primitiveNames[type.enumUnderlyingType?.specialType] ?? 'int' };
  }
  if (fullNameOf(type) === 'System.Type') return 'System.Type';
  throw new MetadataEmitError(`an attribute argument of type '${type.toDisplayString()}' cannot be written`);
}

/** The value of a bound attribute argument in the shape its descriptor takes. */
export function valueOf(expression, type, tokens) {
  if (expression.kind === 'TypeOf') {
    const value = expression.operandType ? serializedTypeName(expression.operandType, tokens) : null;
    return type.specialType === 'System_Object' ? { type: 'System.Type', value } : value;
  }
  if (expression.kind === 'ArrayCreation') {
    const arrayType = expression.type;
    const value = (expression.elements ?? []).map(element => valueOf(element, arrayType.elementType, tokens));
    return type.specialType === 'System_Object' ? { type: descriptorOf(arrayType, tokens), value } : value;
  }
  const constant = expression.constantValue;
  if (constant) {
    const value = constant.isNull ? null : constant.value;
    // A value passed as `object` carries its own type.
    return type.specialType === 'System_Object' && value !== null ? { type: descriptorOf(expression.operand?.type ?? expression.type, tokens), value } : value;
  }
  if (expression.kind === 'Conversion' && expression.operand) return valueOf(expression.operand, type, tokens);
  throw new MetadataEmitError('an attribute argument that is not a constant, a typeof or an array of those cannot be written');
}

/** The value an optional constructor parameter contributes when its argument is left out. */
function omittedValue(parameter) {
  const constant = parameterDefaultConstant(parameter);
  if (constant) return constant.isNull ? null : constant.value;
  const type = parameter?.type;
  if (!type || type.isReferenceType === true) return null;
  return type.specialType === 'System_Boolean' ? false : 0;
}

/**
 * The fixed argument values in parameter order. A `params` parameter given its elements one by one (the expanded
 * form, also with no element at all) takes them as one array; an optional parameter without an argument takes its
 * default value.
 */
export function fixedValues(args, parameterTypes, parameters, tokens) {
  const last = parameterTypes.length - 1,
    hasParamsArray = !!parameters?.at(-1)?.isParams;
  return parameterTypes.map((type, index) => {
    if (hasParamsArray && index === last) {
      const rest = args.slice(last),
        isNormalForm = rest.length === 1 && (rest[0].type instanceof ArrayTypeSymbol || !!rest[0].constantValue?.isNull);
      return isNormalForm ? valueOf(rest[0], type, tokens) : rest.map(argument => valueOf(argument, type.elementType, tokens));
    }
    return index < args.length ? valueOf(args[index], type, tokens) : omittedValue(parameters?.[index]);
  });
}
