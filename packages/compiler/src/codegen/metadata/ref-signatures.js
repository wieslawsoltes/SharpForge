/** CLR signature modifiers of readonly reference declarations, shared by MethodDef and MemberRef signatures. */
import { RefKind, TypeKind, SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';

export const IN_ATTRIBUTE = 'System.Runtime.InteropServices.InAttribute';

/** `ref readonly` return slots require the modifier even on nonvirtual methods. */
export function readonlyReturnModifier(method) {
  return method.refKind === RefKind.RefReadOnly ? IN_ATTRIBUTE : null;
}

function interfaceMethods(type, types) {
  types.refInterfaceMethods ??= new WeakMap();
  let methods = types.refInterfaceMethods.get(type);
  if (methods) return methods;
  methods = new Set();
  for (const implementation of type.interfaceImplementations?.values() ?? []) {
    if (implementation.kind === SymbolKind.Method) methods.add(implementation);
    else {
      for (const accessor of [implementation.getMethod, implementation.setMethod, implementation.addMethod, implementation.removeMethod]) {
        if (accessor) methods.add(accessor);
      }
    }
  }
  types.refInterfaceMethods.set(type, methods);
  return methods;
}

function occupiesVirtualSlot(method, types) {
  const owner = method.containingType;
  return method.isVirtual || method.isAbstract || method.isOverride || method.methodKind === MethodKind.DelegateInvoke ||
    owner?.typeKind === TypeKind.Interface || !!(owner && interfaceMethods(owner, types).has(method));
}

/** Preserve imported modifiers; source virtual `in` and `ref readonly` parameters require an outer InAttribute. */
export function readonlyParameterModifiers(types, method, parameter, inherited = null) {
  if (parameter.customModifiers || inherited) return parameter.customModifiers ?? inherited;
  if (parameter.refKind !== RefKind.In && parameter.refKind !== RefKind.RefReadOnlyParameter) return null;
  if (!occupiesVirtualSlot(method, types)) return null;
  const token = types.builder.typeRef(IN_ATTRIBUTE, types.assemblyOf({}, IN_ATTRIBUTE));
  return { outer: [{ isOptional: false, token }], inner: [] };
}
