/**
 * Reading the attributes the attribute binder (./attributes.js) recorded on a symbol as `boundAttributes`.
 * These helpers have no dependencies, so the body binder and the language rules can use them without importing the
 * attribute binder, which itself binds bodies.
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
