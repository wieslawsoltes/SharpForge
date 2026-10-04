import { TypeKind } from '../../symbols/types.js';

/** Delegate declarations place return attributes on their runtime-implemented Invoke method. */
export function returnAttributeSymbols(method) {
  if (!method) return [];
  const type = method.containingType;
  return type?.typeKind === TypeKind.Delegate && type.delegateInvokeMethod === method ? [method, type] : [method];
}

export function hasReturnAttributes(method) {
  return returnAttributeSymbols(method).some(symbol => symbol.boundAttributes?.some(attribute => attribute.location === 'return'));
}
