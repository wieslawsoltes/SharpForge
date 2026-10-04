/**
 * Covariant return overrides (C# 9): `class Circle : Shape { public override Circle Clone() ... }`.
 *
 * The CLR matches an override to its slot by name and signature, and the return type is part of the signature. An
 * override with another return type therefore declares a slot of its own (`newslot virtual`) and says which method
 * it overrides with a MethodImpl row; `[PreserveBaseOverrides]` on it makes the runtime keep the base slots in step
 * (custom-attributes.js). The same holds for the getter of a property overridden with a more derived type.
 */

/** A member of a constructed type that stands for `symbol` of its definition: what a call on that type names. */
export function memberOn(owner, symbol) {
  if ((owner.originalDefinition ?? owner) === owner) return symbol;
  return Object.create(symbol, { containingType: { value: owner }, originalDefinition: { value: symbol } });
}

/** The base class of `type` (as `type` constructs it) whose definition declares `member`, or null. */
function declaringBaseOf(type, member) {
  const declaring = member.containingType?.originalDefinition ?? member.containingType;
  for (let base = type.baseType; base; base = base.baseType) {
    if ((base.originalDefinition ?? base) === declaring) return base;
  }
  return null;
}

/**
 * The method a covariant override overrides, named on the base class as `type` sees it.
 * @param type the source type that declares `method`  @param method a method or accessor symbol
 * @returns the overridden method, or null when `method` is no override with a covariant return type
 */
export function covariantOverrideOf(type, method) {
  const declaration = method.associatedSymbol ?? method;
  if (!declaration.hasCovariantReturn || !method.overriddenMethod) return null;
  const overridden = method.overriddenMethod.originalDefinition ?? method.overriddenMethod,
    owner = declaringBaseOf(type, overridden);
  return owner ? memberOn(owner, overridden) : null;
}
