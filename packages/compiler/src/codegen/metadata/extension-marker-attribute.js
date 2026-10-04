/** The shipped marker attribute, or a local definition when the selected reference surface predates .NET 10. */
import { Accessibility } from '../../symbols/types.js';
import { AttributeTargets as Target } from '../../symbols/attribute-types.js';
import { fieldAttributeContract } from './compiler-attribute-symbols.js';

export const EXTENSION_MARKER_ATTRIBUTE = 'System.Runtime.CompilerServices.ExtensionMarkerAttribute';
export const ExtensionMetadataBody = Object.freeze({
  Declaration: 'extensionDeclaration',
});

/** Resolve the actual marker contract by symbol identity; synthesize a complete attribute if it is unavailable. */
export function extensionMarkerAttribute(registry) {
  return registry.getOrCreate(EXTENSION_MARKER_ATTRIBUTE, (analysis, existing) => fieldAttributeContract(analysis, existing, {
    fullName: EXTENSION_MARKER_ATTRIBUTE, fieldName: '_name', fieldType: analysis.core.string, parameterName: 'name',
    fieldAccessibility: Accessibility.Private, propertyName: 'Name', usage: {
      targets: Target.Class | Target.Struct | Target.Enum | Target.Method | Target.Property | Target.Field |
        Target.Event | Target.Interface | Target.Delegate,
      allowMultiple: false, inherited: false,
    },
  }));
}
