import { TypeKind } from '../../symbols/types.js';

/** Invoke and EndInvoke both inherit the delegate declaration's return attributes. */
export function returnAttributeSymbols(method) {
  if (!method) return [];
  const type = method.containingType;
  return type?.typeKind === TypeKind.Delegate && type.delegateInvokeMethod === method ? [method, type] : [method];
}

export function hasReturnAttributes(method) {
  return returnAttributeSymbols(method).some(symbol => symbol.boundAttributes?.some(attribute => attribute.location === 'return'));
}

/** A planned runtime member may share the source return contract without sharing a MethodDef symbol. */
export function returnAttributeSource(planned) {
  return planned.symbol ?? planned.attributeSymbol ?? planned.returnAttributeSource;
}
