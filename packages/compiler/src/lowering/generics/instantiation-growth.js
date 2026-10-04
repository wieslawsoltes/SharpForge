/**
 * Polymorphic recursion: the proof that a generic instantiates itself with ever larger type arguments (SF-A02-T02).
 *
 *   static int Depth<T>(T x, int n) { return n == 0 ? 0 : 1 + Depth(new Box<T>(x), n - 1); }
 *
 * .NET creates `Depth<Box<Box<int>>>` when the call runs; monomorphization needs every construction before the
 * program starts, and there is no finite set of them. Instead of instantiating until a depth limit is hit, the
 * growth is proved from the way constructions ask for each other.
 *
 * Every construction remembers the construction whose code asked for it first (`parent`) and the type arguments as
 * that code wrote them, open over the parent's type parameters (`openMap`): `Depth<Box<T>>` asked for by `Depth<T>`
 * has the open map `T -> Box<T>`. Walking up the parents and composing the open maps gives, for an ancestor that is
 * a construction of the same definition, the substitution `theta` one round of the cycle applies to the definition's
 * own type parameters. The same code is lowered for every construction, so a construction `M<a>` asks for
 * `M<theta(a)>`, that one for `M<theta(theta(a))>`, and so on. If iterating `theta` puts a type parameter strictly
 * inside its own image (`T -> Box<T>`, or `A -> B, B -> Box<A>` after two rounds), the arguments grow without end.
 *
 * The proof is only attempted when every step of the chain is known to be independent of the closed type arguments:
 * a request whose target was chosen from a closed type (a call through a constraint, a type the type mapper closed
 * first) has no open map and ends the chain. Such a cycle is still stopped by the nesting limit.
 */
import { TypeMap, typeOf } from '../../symbols/types.js';
import { containsTypeParameter } from '../../symbols/substitution.js';

/** `theta` applied after `inner`: the terms of `theta` rewritten over the type parameters `inner` is written over. */
function compose(theta, parameters, inner) {
  return TypeMap.empty.with(
    parameters,
    parameters.map(parameter => typeOf(inner.substituteType(theta.get(parameter) ?? parameter))),
  );
}

/** The type parameter that ends up strictly inside its own image when `theta` is iterated, with that image; or null. */
function growingParameter(theta, parameters) {
  let terms = parameters.map(parameter => typeOf(theta.get(parameter) ?? parameter));
  for (let round = 0; round < parameters.length; round++) {
    for (let i = 0; i < parameters.length; i++) {
      if (terms[i] !== parameters[i] && containsTypeParameter(terms[i], [parameters[i]])) return { parameter: parameters[i], term: terms[i] };
    }
    terms = terms.map(term => typeOf(theta.substituteType(term)));
  }
  return null;
}

/**
 * Proves that a construction about to be created belongs to a cycle that grows.
 * @param definition the generic class, or the method, the construction is of
 * @param parameters the type parameters its substitution binds (enclosing types first)
 * @param {TypeMap|null} openMap its type arguments as written, over the type parameters of `parent`; null when unknown
 * @param parent the construction whose code asks for it (`{definition, openMap, parent}`), or null
 * @returns {{parameter, term}|null} the type parameter that grows and what one round turns it into
 */
export function provenGrowth(definition, parameters, openMap, parent) {
  if (!openMap || !parameters.length) return null;
  let theta = openMap;
  for (let ancestor = parent, steps = 0; ancestor && steps < 256; ancestor = ancestor.parent, steps++) {
    if (ancestor.definition === definition) {
      const growing = growingParameter(theta, parameters);
      if (growing) return growing;
    }
    if (!ancestor.openMap) return null;
    theta = compose(theta, parameters, ancestor.openMap);
  }
  return null;
}
