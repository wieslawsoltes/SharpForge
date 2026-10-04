import {SymbolKind, TypeKind} from '../../symbols/types.js';

const signatures = Object.freeze({ToString: ['System_String'], Equals: ['System_Boolean', 'System_Object'],
  GetHashCode: ['System_Int32']});

/** Only the ordinary Object instance signatures participate in runtime virtual dispatch. */
export function objectSlotSymbol(symbol) {
  const signature = signatures[symbol.name];
  if (!signature || symbol.isStatic || symbol.typeParameters?.length || symbol.returnType.specialType !== signature[0] ||
      symbol.parameters.length !== signature.length - 1 ||
      !symbol.parameters.every((parameter, index) => parameter.type.specialType === signature[index + 1])) return null;
  return symbol.name;
}

export function sourceObjectOverride(symbol) {
  const slot = objectSlotSymbol(symbol);
  if (!slot || !symbol.isOverride) return null;
  let declaration = symbol;
  for (let depth = 0; depth < 128; depth++) {
    declaration = declaration.overriddenMethod;
    if (!declaration) return null;
    if (declaration.containingType.specialType === 'System_Object') return slot;
  }
  return null;
}

/** A concrete value receiver has one exact override; call it on its original managed storage. */
export function sourceValueObjectOverride(method, receiverType) {
  if (method.containingType?.specialType !== 'System_Object' || receiverType?.typeKind !== TypeKind.Struct) return null;
  const slot = objectSlotSymbol(method);
  if (!slot) return null;
  return receiverType.getMembers(method.name).find(member =>
    member.kind === SymbolKind.Method && sourceObjectOverride(member) === slot) ?? null;
}
