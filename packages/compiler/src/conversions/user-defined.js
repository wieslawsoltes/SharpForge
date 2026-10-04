/**
 * User-defined conversions (SF-A02-T06.4, C# spec 10.5).
 *
 * Operators are searched in the source type S0, its base classes and the target type T0 (and, for explicit
 * conversions, T0's base classes), S0/T0 being S and T with a trailing `?` removed. An operator applies when a
 * standard conversion leads from S to its parameter type and from its return type to T (implicit: encompassing /
 * encompassed-by; explicit: in either direction). The most specific source and target types select exactly one
 * operator; none or several is CS0457. Operators over non-nullable value types also apply in lifted form to S? / T?.
 */
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { baseTypeChain } from '../symbols/substitution.js';
import { isNullableType, stripNullable } from './nullable.js';

/** The conversion operators a type declares, looked up by name (member lists of framework types are long). */
const operatorsOf = (type, names) =>
  type.getMembers ? names.flatMap(name => type.getMembers(name)).filter(m => m.kind === SymbolKind.Method && m.parameters.length === 1) : [];
const declaringTypes = (type, core, withBases) => {
  if (!type || type.typeKind === TypeKind.Interface) return [];
  if (type.typeKind === TypeKind.TypeParameter) return withBases ? baseTypeChain(type, core).slice(1) : [];
  return withBases ? baseTypeChain(type, core) : [type];
};
/**
 * @param from,to TypeSymbols  @param {{explicit:boolean}} options
 * @param standard `{implicit(a,b):boolean, explicit(a,b):boolean}` standard (non-user-defined) conversion tests; `explicit` includes implicit
 * @returns {null|{method,isLifted,isImplicit,sourceType,targetType}|{ambiguous:true,candidates}}
 */
export function resolveUserDefinedConversion(from, to, { explicit = false } = {}, standard, core) {
  const s0 = stripNullable(from),
    t0 = stripNullable(to),
    names = explicit ? ['op_Implicit', 'op_Explicit'] : ['op_Implicit'];
  const types = [];
  for (const t of [...declaringTypes(s0, core, true), ...declaringTypes(t0, core, explicit)])
    if (!types.some(x => x.equals(t))) types.push(t);
  if (!types.length) return null;
  const candidates = [];
  for (const type of types)
    for (const method of operatorsOf(type, names)) {
      const p = method.parameters[0].type,
        r = method.returnType;
      if (!p || !r) continue;
      // Implicit: S is encompassed by the parameter type and the return type by T. Explicit also accepts the reverse
      // (S encompasses the parameter type, the return type encompasses T) when the standard explicit conversion that
      // then has to run exists: `double` and `decimal` encompass each other in neither direction.
      const sourceOk = (src, par) => src.equals(par) || standard.implicit(src, par) || (explicit && encompasses(src, par, standard));
      const targetOk = (ret, dst) => ret.equals(dst) || standard.implicit(ret, dst) || (explicit && encompasses(ret, dst, standard));
      // Roslyn (beyond the specification) lets S? use an operator declared for S when the result type can hold null.
      const valueParameter = p.isValueType === true && !isNullableType(p);
      const resultHoldsNull = r.isValueType !== true || isNullableType(r);
      if (isNullableType(from) && valueParameter && resultHoldsNull && sourceOk(s0, p) && targetOk(r, to)) {
        candidates.push({ method, source: p, target: r, isLifted: false, fromUnderlying: true });
        continue;
      }
      if (sourceOk(from, p) && targetOk(r, to)) {
        candidates.push({ method, source: p, target: r, isLifted: false });
        continue;
      }
      // Lifted form: S? -> T? through an operator over non-nullable value types (null maps to null).
      const liftable = p.isValueType === true && !isNullableType(p) && r.isValueType === true && !isNullableType(r);
      if (liftable && isNullableType(from) && sourceOk(s0, p) && (isNullableType(to) ? targetOk(r, t0) : explicit && targetOk(r, to)))
        candidates.push({ method, source: p, target: r, isLifted: isNullableType(to), unwraps: !isNullableType(to) });
      else if (!isNullableType(from) && isNullableType(to) && sourceOk(from, p) && targetOk(r, t0))
        candidates.push({ method, source: p, target: r, isLifted: false, wraps: true });
    }
  if (!candidates.length) return null;
  const encompassedBy = (a, b) => a.equals(b) || standard.implicit(a, b);
  const mostEncompassed = list => list.find(x => list.every(y => encompassedBy(x, y))) ?? null;
  const mostEncompassing = list => list.find(x => list.every(y => encompassedBy(y, x))) ?? null;
  const sources = dedupe(candidates.map(c => c.source)),
    targets = dedupe(candidates.map(c => c.target));
  const exactSource = sources.find(x => x.equals(from)) ?? sources.find(x => x.equals(s0)),
    exactTarget = targets.find(x => x.equals(to)) ?? targets.find(x => x.equals(t0));
  let sx, tx;
  if (exactSource) sx = exactSource;
  else if (!explicit) sx = mostEncompassed(sources);
  else {
    const encompassing = sources.filter(x => encompassedBy(s0, x));
    sx = encompassing.length ? mostEncompassed(encompassing) : mostEncompassing(sources);
  }
  if (exactTarget) tx = exactTarget;
  else if (!explicit) tx = mostEncompassing(targets);
  else {
    const encompassed = targets.filter(x => encompassedBy(x, t0));
    tx = encompassed.length ? mostEncompassing(encompassed) : mostEncompassed(targets);
  }
  if (!sx || !tx) return { ambiguous: true, candidates: candidates.map(c => c.method) };
  const chosen = candidates.filter(c => c.source.equals(sx) && c.target.equals(tx));
  if (chosen.length !== 1) {
    // An implicit and an explicit operator with the same signature cannot coexist (CS0557), so several means ambiguity.
    if (chosen.length > 1 && chosen.every(c => c.method.equals(chosen[0].method))) return finish(chosen[0], explicit, standard, from, to);
    return { ambiguous: true, candidates: (chosen.length ? chosen : candidates).map(c => c.method) };
  }
  return finish(chosen[0], explicit, standard, from, to);
}
function finish(c, explicit, standard, from, to) {
  // A lifted operator (and one whose result can hold null) takes the underlying type of S?; otherwise S itself must
  // reach the parameter type implicitly, so S? -> T unwraps explicitly.
  const source = c.isLifted || c.fromUnderlying ? stripNullable(from) : from;
  const isImplicit =
    c.method.name === 'op_Implicit' &&
    !c.unwraps &&
    (standard.implicit(source, c.source) || source.equals(c.source)) &&
    (standard.implicit(c.target, to) || c.target.equals(to) || c.target.equals(stripNullable(to)));
  return { method: c.method, isLifted: !!c.isLifted, isImplicit, sourceType: c.source, targetType: c.target };
}
/** A encompasses B (a standard implicit conversion leads from B to A) and the standard explicit conversion A -> B exists. */
function encompasses(a, b, standard) {
  return standard.implicit(b, a) && standard.explicit(a, b);
}
function dedupe(types) {
  const out = [];
  for (const t of types) if (!out.some(x => x.equals(t))) out.push(t);
  return out;
}
