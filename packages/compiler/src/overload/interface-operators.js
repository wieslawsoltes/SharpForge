/**
 * Operators an interface declares for its implementers (SF-A02-T03.6, C# 11 static abstract members).
 *
 * An operand whose type is a type parameter has no operators of its own. When its effective base class declares none,
 * the `static abstract` and `static virtual` operators of the interfaces it is constrained to are the candidates
 * (generic math: `T a, b; a + b` with `where T : IAdditionOperators<T, T, T>`). An interface with an operator that is
 * applicable to the operands hides the operators of the interfaces it derives from; one whose operators do not apply
 * hides nothing. The call is a constrained call on the type parameter: the implementing type supplies the operator
 * that runs.
 */
import { TypeKind, SymbolKind } from '../symbols/types.js';
import { allInterfacesOf } from '../symbols/substitution.js';

const isInterfaceVirtual = method => method.kind === SymbolKind.Method && method.isStatic && (method.isAbstract || method.isVirtual);

/** The static abstract / virtual operator methods named `name` that a type parameter gets from its constraint interfaces. */
export function interfaceOperators(typeParameter, name, core) {
  if (typeParameter?.typeKind !== TypeKind.TypeParameter) return [];
  // One list per type parameter and name: both operands of `a + b` then offer the same method symbols.
  const cache = (typeParameter.interfaceOperators ??= new Map());
  if (cache.has(name)) return cache.get(name);
  const seen = [],
    operators = [];
  for (const iface of allInterfacesOf(typeParameter, core)) {
    if (seen.some(other => other.equals(iface))) continue;
    seen.push(iface);
    operators.push(...iface.getMembers(name).filter(isInterfaceVirtual));
  }
  cache.set(name, operators);
  return operators;
}

/**
 * The candidates that remain once the operators of an interface are hidden by an applicable operator of an interface
 * that derives from it. Candidates that are not interface members are kept as they are.
 * @param {object[]} candidates operator methods  @param {(method:object)=>boolean} isApplicable to the operands
 */
export function withoutHiddenInterfaceOperators(candidates, isApplicable, core) {
  const ofInterface = method => method.containingType?.typeKind === TypeKind.Interface;
  if (!candidates.some(ofInterface)) return candidates;
  const hiding = candidates.filter(method => ofInterface(method) && isApplicable(method)).map(method => method.containingType),
    isHidden = method => ofInterface(method) && hiding.some(iface => allInterfacesOf(iface, core).some(base => base.equals(method.containingType)));
  return candidates.filter(method => !isHidden(method));
}

/**
 * The type parameter through which a static abstract / virtual interface member is used, among the types involved
 * (the operand types of an operator): the first one constrained to the interface that declares the member.
 * @returns the type parameter, or null when the member is not such a member or none of the types reaches it
 */
export function constrainedTypeParameter(member, types, core) {
  const declaring = member?.containingType;
  if (!declaring || declaring.typeKind !== TypeKind.Interface || !member.isStatic || !(member.isAbstract || member.isVirtual)) return null;
  const reaches = type => type?.typeKind === TypeKind.TypeParameter && allInterfacesOf(type, core).some(iface => iface.equals(declaring));
  return types.find(reaches) ?? null;
}
