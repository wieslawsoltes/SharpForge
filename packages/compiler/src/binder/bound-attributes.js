/**
 * Reading the attributes the attribute binder recorded on a symbol (`boundAttributes`, see ./attributes.js). Kept
 * apart from the binder so that the modules interpreting a well-known attribute do not depend on the body binder.
 */

/** The namespace-qualified name of a named type, without type arguments (`System.ObsoleteAttribute`). */
export function fullNameOf(type) {
  const parts = [];
  for (let s = type?.originalDefinition ?? type; s && s.name; s = s.containingSymbol) parts.unshift(s.name);
  return parts.join('.');
}

/** The bound attributes of a symbol whose class has the full name `fullName`. */
export function attributesNamed(symbol, fullName) {
  return (symbol?.boundAttributes ?? []).filter(attribute => fullNameOf(attribute.attributeClass) === fullName);
}
