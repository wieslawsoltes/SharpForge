/**
 * Whose parameter names and default values a call uses when the method is overridden.
 *
 * Overload resolution works on the declaration of a virtual method - overrides are not candidates (C# spec
 * 12.6.4.2) - but an override may rename the parameters and give them other default values. Roslyn takes both from
 * the most derived override that member lookup finds on the receiver's type:
 *
 *   class A { public virtual string F(int width = 10) ... }   class B : A { public override string F(int width = 20) ... }
 *   new B().F()         passes 20        ((A)new B()).F()        passes 10
 *
 * The call still names the declaration (`callvirt A::F`), so this affects only the argument list.
 */

import { baseImplementationOf } from '../symbols/base-implementation.js';

const isOverridable = method => !!(method.isVirtual || method.isAbstract) && !method.isStatic;

/**
 * The most derived override of each overridable method of a method group, as seen from the receiver.
 * @param {object[]} methods the method group (declarations; member lookup leaves overrides out)
 * @param receiverType the static type of the receiver, or null when there is none
 * @returns {Map<object, object> | null} declaration (original definition) -> the overriding method or indexer; null
 *   when nothing is overridden
 */
export function overridesOnReceiver(methods, receiverType) {
  if (!receiverType) return null;
  let found = null;
  for (const method of methods) {
    if (!isOverridable(method)) continue;
    const override = baseImplementationOf(method, receiverType);
    if (override === method) continue;
    // An indexer is resolved through an accessor seen with the indexer's parameters: so is its override.
    const indexer = override.associatedSymbol?.parameters?.length ? override.associatedSymbol : null;
    (found ??= new Map()).set(method.originalDefinition ?? method, indexer ?? override);
  }
  return found;
}

/**
 * The parameters argument names and omitted optional arguments are matched against: those of `override` when it
 * has the same parameter list as `method`, else the method's own.
 */
export function namingParameters(method, override) {
  return override && override.parameters.length === method.parameters.length ? override.parameters : method.parameters;
}

/**
 * The parameter that says what an omitted argument of a bound call is: its default value and syntax.
 * @param node a bound call (`defaultsFrom` is the override recorded by the binder, if any)
 * @param parameter the parameter of the called method  @param {number} index its position
 */
export function defaultSourceOf(node, parameter, index) {
  const source = node.defaultsFrom?.parameters[index];
  if (!source || source === parameter) return parameter;
  // The override says the value; the called method keeps saying the (constructed) type and the position.
  return Object.assign(Object.create(parameter), {
    defaultSyntax: source.defaultSyntax,
    defaultBound: source.defaultBound,
    explicitDefaultValue: source.explicitDefaultValue,
    defaultValue: source.defaultValue,
    hasExplicitDefaultValue: source.hasExplicitDefaultValue,
    isOptional: source.isOptional,
  });
}
