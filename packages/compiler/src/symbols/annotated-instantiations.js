/**
 * Nullable annotations on shared framework instantiations (SF-A02-T05.4).
 *
 * The framework registry hands out one object per closed type (`Func<string>`), whatever annotations the type
 * arguments were written with, so `Func<string>` and `Func<string?>` were the same symbol and the annotation was lost.
 * For delegate types - where the nullable analysis needs it to check a lambda against its target - an instantiation
 * written with annotations is a view of the shared object: the same members, identity (`unannotated`) and equality,
 * with its own `typeArguments`. Views are interned per annotation pattern, so the same written type gives the same
 * object. Other framework types keep the shared object: their identity is what the lowering looks them up by.
 *
 * symbols/types.js calls this from `construct`, so this module imports nothing from it (the worker bundle allows no
 * module cycle): the type kind and the annotation that mean 'delegate' and 'oblivious' are passed in.
 */
/**
 * @param instance the shared instantiation, or null/undefined when the registry has none
 * @param {object[]} typeArguments the type arguments as written (`{type, nullableAnnotation}`)
 * @param {{delegate: string, oblivious: string}} kinds `TypeKind.Delegate` and `NullableAnnotation.Oblivious`
 * @returns the instance, a view of it with these annotations, or the null/undefined it was given
 */
export function withTypeArgumentAnnotations(instance, typeArguments, kinds) {
  if (!instance || instance.typeKind !== kinds.delegate) return instance;
  if (typeArguments.every(argument => argument.nullableAnnotation === kinds.oblivious)) return instance;
  const key = typeArguments.map(argument => argument.nullableAnnotation).join(),
    views = (instance.annotatedViews ??= new Map());
  let view = views.get(key);
  if (!view) {
    view = Object.create(instance);
    Object.defineProperty(view, 'typeArguments', { value: Object.freeze([...typeArguments]), enumerable: true });
    view.unannotated = instance;
    views.set(key, view);
  }
  return view;
}
