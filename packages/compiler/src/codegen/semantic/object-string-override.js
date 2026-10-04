import {Accessibility} from '../../symbols/types.js';

/** Admit only a bound, ordinary override of Object's exact public string-returning slot. */
export function isObjectStringOverride(method) {
  const target = method.overriddenMethod;
  return method.isOverride && !method.isAbstract && !method.isStatic && !method.isExtern && !method.isVararg &&
    method.name === 'ToString' && method.parameters.length === 0 && !method.arity &&
    method.returnType.specialType === 'System_String' && method.declaredAccessibility === Accessibility.Public &&
    !method.explicitInterfaceImplementations.length && (!method.refKind || method.refKind === 'none') &&
    target?.containingType.specialType === 'System_Object' && target.name === 'ToString' &&
    target.parameters.length === 0 && !target.arity && target.returnType.specialType === 'System_String' &&
    target.isVirtual && !target.isStatic && target.declaredAccessibility === Accessibility.Public;
}
