/**
 * Closed classes read from metadata (SF-A02-T90). PROVISIONAL: C# 15 preview, after
 * csharplang/proposals/csharp-15.0/closed-hierarchies.md revision 1 (packages/syntax/src/preview-revisions.js); the
 * pinned Roslyn does not implement the feature.
 *
 * "Lowering": "Closed classes are generated with an `IsClosedType` attribute, to allow them to be recognized by a
 * consuming compiler." A class of a referenced assembly that carries
 * `System.Runtime.CompilerServices.IsClosedTypeAttribute` is therefore a closed class here.
 *
 * "Same-assembly restriction": "If a class in one assembly is declared `closed` then it is an error to directly
 * derive from it in another assembly." So the subtypes of an imported closed class are exactly the classes of its own
 * assembly that derive from it directly: they are collected from that assembly, and a source class that names the
 * closed class as its base is an error (./preview-features.js reports it).
 *
 * "Blocking subtyping from other languages/compilers": the constructors of a closed class carry
 * `[CompilerFeatureRequired("ClosedClasses")]`; this compiler knows the feature (metadata-import/attributes.js), so
 * they stay usable.
 *
 * Not decided by the proposal and not done here: the module half of the restriction ("The same restriction applies to
 * modules") - a compilation here is one module.
 */
import { TypeKind } from '../symbols/types.js';

export const closedTypeAttribute = 'System.Runtime.CompilerServices.IsClosedTypeAttribute';

/** Every class of a namespace tree, nested classes included. */
function* classesOf(namespace) {
  const nested = function* (type) {
    yield type;
    for (const inner of type.getTypeMembers?.() ?? []) yield* nested(inner);
  };
  for (const type of namespace.allTypes()) yield* nested(type);
}

/**
 * True when a class definition read from metadata is a closed class. The first call records it as one
 * (`isClosedClass`) with the classes of its assembly that derive from it directly (`closedSubtypes`), the shape the
 * exhaustiveness rules read for source classes.
 */
export function isImportedClosedClass(definition) {
  if (!definition || definition.isSource || !definition.containingAssembly) return false;
  if (definition.importedClosedState !== undefined) return definition.importedClosedState;
  const isMarker = attribute => (attribute.attributeClassName ?? attribute.attributeClass?.toDisplayString()) === closedTypeAttribute,
    marked = definition.typeKind === TypeKind.Class && (definition.attributes ?? []).some(isMarker);
  definition.importedClosedState = marked;
  if (!marked) return false;
  definition.isClosedClass = true;
  definition.closedSubtypes = [];
  for (const type of classesOf(definition.containingAssembly.globalNamespace)) {
    if (type.typeKind !== TypeKind.Class || type.baseType?.originalDefinition !== definition) continue;
    definition.closedSubtypes.push(type);
    isImportedClosedClass(type);
  }
  return true;
}
