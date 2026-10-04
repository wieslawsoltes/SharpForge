import { TypeKind } from '../../symbols/types.js';

/** Invoke and EndInvoke both inherit the delegate declaration's return attributes. */
export function returnAttributeSymbols(method) {
  if (!method) return [];
  const type = method.containingType;
  return type?.typeKind === TypeKind.Delegate && type.delegateInvokeMethod === method ? [method, type] : [method];
}

function hasReturnAttributeOn(symbol) {
  const attributes = symbol.boundAttributes;
  if (!attributes) return false;
  for (let index = 0; index < attributes.length; index++) {
    if (attributes[index].location === 'return') return true;
  }
  return false;
}

export function hasReturnAttributes(method) {
  if (!method) return false;
  if (hasReturnAttributeOn(method)) return true;
  const type = method.containingType;
  return type?.typeKind === TypeKind.Delegate && type.delegateInvokeMethod === method && hasReturnAttributeOn(type);
}

/** A planned runtime member may share the source return contract without sharing a MethodDef symbol. */
export function returnAttributeSource(planned) {
  return planned.symbol ?? planned.attributeSymbol ?? planned.returnAttributeSource;
}
