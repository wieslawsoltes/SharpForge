import { TypeKind } from '../symbols/types.js';

const features = new Map([
  ['ReadOnlyKeyword', 'readonlyStructs'],
  ['RefKeyword', 'refStructs'],
]);

/** Gate each modifier at Roslyn's span, including partial declarations in separate files. */
export function checkTypeModifierFeatures(type, gate) {
  if (type.typeKind !== TypeKind.Struct) return;
  for (const declaration of type.declarations) {
    const { syntax, uri } = declaration;
    for (const modifier of syntax.modifiers) {
      const feature = features.get(modifier.kind);
      if (feature) gate(uri, modifier, feature);
    }
  }
}
