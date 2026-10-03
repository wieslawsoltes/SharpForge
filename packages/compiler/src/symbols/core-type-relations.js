/**
 * Relations between predefined types that conversion classification depends on and that the closed registry does
 * not record: the base interfaces of the collection interfaces (`IList<T> : ICollection<T> : IEnumerable<T> :
 * IEnumerable`), `System.Array : IEnumerable`, the variance of `Func<...>` and `Action<...>` type parameters, and the
 * existence of `System.FormattableString` (the target of the interpolated string conversion).
 * A definition that already knows its interfaces (a referenced core library) is left alone.
 */
import { Variance } from './types.js';

const funcArities = [1, 2, 3, 4, 5];
const actionArities = [1, 2, 3, 4];

function setInterfaces(definition, interfaces) {
  if (definition.isErrorType() || definition.interfaces.length) return;
  definition._interfaces = interfaces.filter(candidate => !candidate.isErrorType());
}

function declareCollectionInterfaces(core) {
  const of = (definition, owner) => definition.construct(owner.typeParameters[0]);
  setInterfaces(core.ienumerableT, [core.ienumerable]);
  setInterfaces(core.icollectionT, [of(core.ienumerableT, core.icollectionT), core.ienumerable]);
  setInterfaces(core.ilistT, [of(core.icollectionT, core.ilistT), of(core.ienumerableT, core.ilistT), core.ienumerable]);
  setInterfaces(core.ireadOnlyCollectionT, [of(core.ienumerableT, core.ireadOnlyCollectionT), core.ienumerable]);
  setInterfaces(core.ireadOnlyListT, [
    of(core.ireadOnlyCollectionT, core.ireadOnlyListT),
    of(core.ienumerableT, core.ireadOnlyListT),
    core.ienumerable,
  ]);
  setInterfaces(core.array, [core.ienumerable]);
}

/** `Func<in T1, ..., out TResult>` and `Action<in T1, ...>`. */
function declareDelegateVariance(core) {
  for (const arity of funcArities) {
    const parameters = core.func(arity).typeParameters;
    parameters.forEach((parameter, index) => {
      parameter.variance = index === parameters.length - 1 ? Variance.Out : Variance.In;
    });
  }
  for (const arity of actionArities) {
    for (const parameter of core.action(arity).typeParameters) parameter.variance = Variance.In;
  }
}

/** Applies the relations once per bridge and returns the extra core types `{ formattableString }`. */
export function declareCoreTypeRelations(core) {
  declareCollectionInterfaces(core);
  declareDelegateVariance(core);
  return { formattableString: core.bridge.coreType('System_FormattableString') };
}
