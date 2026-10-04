/**
 * What a `base.` access reaches (C# spec 12.8.15). Member lookup finds the declaration of a virtual member - the
 * least derived one; `base.M()` runs the implementation the base class has, which is the override nearest to it:
 *
 *   class A { virtual M }   class B : A { override M }   class C : B { override M { base.M(); } }     runs B.M
 *
 * The call is not virtual, so naming `A.M` would run A's body (and an abstract `A.M` has none).
 */
import { SymbolKind, TypeKind } from './types.js';
import { MethodKind } from './members.js';

const accessorOf = Object.freeze({
  [MethodKind.PropertyGet]: member => member.getMethod,
  [MethodKind.PropertySet]: member => member.setMethod,
  [MethodKind.EventAdd]: member => member.addMethod,
  [MethodKind.EventRemove]: member => member.removeMethod,
});

const sameParameters = (left, right) =>
  left.parameters.length === right.parameters.length && left.parameters.every((parameter, index) => parameter.type.equals(right.parameters[index].type));

/** The override of `method` that `type` itself declares, or null. An accessor is found through its property or event. */
function overrideDeclaredIn(type, method) {
  const owner = method.associatedSymbol,
    pick = accessorOf[method.methodKind];
  if (owner && pick) {
    for (const member of type.getMembers(owner.name)) {
      const accessor = member.kind === owner.kind && member.isOverride ? pick(member) : null;
      if (accessor && sameParameters(accessor, method)) return accessor;
    }
    return null;
  }
  const isOverride = candidate => candidate.kind === SymbolKind.Method && candidate.isOverride && (candidate.arity ?? 0) === (method.arity ?? 0);
  return type.getMembers(method.name).find(candidate => isOverride(candidate) && sameParameters(candidate, method)) ?? null;
}

/**
 * True when a `base.` access to an abstract method, property, indexer or event has nothing to run (CS0205): the
 * override nearest to the base class is abstract as well, or there is none.
 * @param member the abstract member that member lookup found  @param baseType the base class of the accessing type
 */
export function isAbstractBaseAccess(member, baseType) {
  if (!member.isAbstract) return false;
  if (member.kind === SymbolKind.Method) return !!baseImplementationOf(member, baseType).isAbstract;
  const accessor = member.getMethod ?? member.setMethod ?? member.addMethod ?? null,
    nearest = accessor ? baseImplementationOf(accessor, baseType) : null;
  // The nearest override's accessor belongs to the property or event that says whether it is abstract.
  return !nearest || nearest === accessor || !!(nearest.associatedSymbol ?? nearest).isAbstract;
}

/** True when `candidate` overrides `definition`, directly or through the overrides in between. */
function overridesDefinition(candidate, definition) {
  for (let current = candidate.overriddenMethod; current; current = current.overriddenMethod) {
    if ((current.originalDefinition ?? current) === definition) return true;
  }
  return false;
}

/**
 * `base.M<T>(...)`: the nearest override of the generic method, constructed over the same type arguments. The type
 * parameters of an override are its own, so it is found through the `overriddenMethod` links the binder recorded.
 */
function constructedBaseImplementation(method, baseType) {
  const definition = method.constructedFrom ?? method.originalDefinition,
    declaring = definition?.containingType;
  if (!definition || !declaring || declaring.typeKind === TypeKind.Interface) return method;
  if (!(definition.isVirtual || definition.isAbstract || definition.isOverride)) return method;
  const declaringDefinition = declaring.originalDefinition ?? declaring;
  for (let type = baseType; type; type = type.baseType) {
    if ((type.originalDefinition ?? type) === declaringDefinition) break;
    const found = type.getMembers(definition.name).find(candidate => candidate.kind === SymbolKind.Method && overridesDefinition(candidate, definition));
    if (found) return found.construct(method.typeArguments.map(argument => argument.type ?? argument));
  }
  return method;
}

/**
 * The method a non-virtual call through `base` runs.
 * @param method the virtual method member lookup found  @param baseType the base class of the type the call is in
 * @returns the nearest override between `baseType` and the declaring class, or `method` itself when there is none
 *   (also for a member of an interface and a non-virtual method, which are left alone)
 */
export function baseImplementationOf(method, baseType) {
  if (method.typeArguments?.length) return constructedBaseImplementation(method, baseType);
  const declaring = method.containingType,
    slot = method.associatedSymbol ?? method,
    isVirtual = [method, slot].some(symbol => symbol.isVirtual || symbol.isAbstract || symbol.isOverride);
  if (!isVirtual || !declaring || declaring.typeKind === TypeKind.Interface || method.typeArguments?.length) return method;
  const declaringDefinition = declaring.originalDefinition ?? declaring;
  for (let type = baseType; type; type = type.baseType) {
    if ((type.originalDefinition ?? type) === declaringDefinition) break;
    const found = overrideDeclaredIn(type, method);
    if (found) return found;
  }
  return method;
}
