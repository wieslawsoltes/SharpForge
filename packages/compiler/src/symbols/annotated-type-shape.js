/** Structural rebuilding shared by metadata type transforms; symbol definitions and modifiers remain unchanged. */
import { ArrayTypeSymbol, ConstructedNamedTypeSymbol, ErrorTypeSymbol, FunctionPointerTypeSymbol, TypeKind } from './types.js';

function ownArguments(type) {
  const outer = type.containingType;
  return type.isDefinition && !(outer?.isGenericType && !outer.isDefinition) ? [] : type.typeArguments;
}

/** Type arguments of a named type, including every containing type, in O(arguments + nesting depth). */
export function flatTypeArguments(type) {
  const chain = [];
  for (let current = type; current; current = current.containingType) chain.push(current);
  const argumentsInOrder = [];
  for (let index = chain.length - 1; index >= 0; index--) argumentsInOrder.push(...ownArguments(chain[index]));
  return argumentsInOrder;
}

/** Replaces a named type's flattened arguments while preserving its containing types and tuple names. */
export function withTypeArguments(type, argumentsInOrder) {
  const chain = [];
  for (let current = type; current; current = current.containingType) chain.push(current);
  let outer = null;
  let offset = 0;
  for (let index = chain.length - 1; index >= 0; index--) {
    const current = chain[index];
    const count = ownArguments(current).length;
    const own = argumentsInOrder.slice(offset, offset + count);
    offset += count;
    if (outer === current.containingType && own.every((argument, ordinal) => argument === current.typeArguments[ordinal])) {
      outer = current;
      continue;
    }
    const definition = current.originalDefinition;
    // Registry delegates expose closed Invoke signatures and interned annotation views through construct().
    const replacement = !outer && definition.typeKind === TypeKind.Delegate && definition.instanceProvider
      ? definition.construct(own) : new ConstructedNamedTypeSymbol(definition, own, outer);
    replacement.tupleElementNames = current.tupleElementNames;
    outer = replacement;
  }
  return outer;
}

/** Replaces an array element without losing rank, bounds shape, or its framework base and interfaces. */
export function withArrayElement(type, element) {
  if (element === type.elementTypeWithAnnotations) return type;
  return new ArrayTypeSymbol(element, type.rank, {
    isSZArray: type.isSZArray,
    baseType: type._base,
    interfaces: type._interfaces,
  });
}

/** An unresolved generic type keeps its diagnostic identity while its type arguments receive annotations. */
export function withErrorTypeArguments(type, argumentsInOrder) {
  if (argumentsInOrder.every((argument, index) => argument === type.typeArguments[index])) return type;
  const replacement = new ErrorTypeSymbol(type.name, type.arity, {
    candidates: type.candidates, reason: type.reason, containingSymbol: type.containingSymbol, typeArguments: argumentsInOrder,
  });
  replacement.locations = type.locations;
  if (type.metadataFullName !== undefined) replacement.metadataFullName = type.metadataFullName;
  return replacement;
}

/** Maps the return and parameter types of a function pointer, preserving its ABI and by-reference slots. */
export function withFunctionPointerTypes(type, visit) {
  const signature = type.signature;
  const returnType = visit(signature.returnType, signature.returnRefKind);
  const parameters = signature.parameters.map(parameter => ({ type: visit(parameter.type, parameter.refKind), refKind: parameter.refKind }));
  if (returnType === signature.returnType && parameters.every((parameter, index) => parameter.type === signature.parameters[index].type)) {
    return type;
  }
  return new FunctionPointerTypeSymbol({ ...signature, returnType, parameters });
}
