import {defaultPropertyValue} from './validation.js';

/** Register released attached accessors once, preserving their public owner/name identity. */
export function registerBuiltInAttachedProperties(registry, descriptors) {
  const byContract = new Map();
  const byHostProperty = new Map();
  for (const descriptor of descriptors) {
    if (descriptor.kind !== 'attachedSet' && descriptor.kind !== 'attachedGet') continue;
    const name = descriptor.name.slice(3);
    const ownerType = registry.canonicalType(descriptor.owner);
    let property = registry.owners.get(ownerType)?.get(name);
    if (!property) {
      const propertyType = descriptor.kind === 'attachedSet' ? descriptor.parameters.at(-1) : descriptor.result;
      const declared = registry.getDeclaredProperty(ownerType, name);
      const span = name.endsWith('Span');
      property = registry.registerAttached({
        ownerType,
        name,
        propertyType,
        metadata: {
          defaultValue: declared?.value ?? (span ? 1 : defaultPropertyValue(propertyType, registry.services.typeDefinition?.(propertyType))),
          minimum: span ? 1 : name === 'Row' || name === 'Column' ? 0 : undefined,
          hostProperty: descriptor.property ?? name,
          ...declared?.metadata,
          ...descriptor.metadata
        }
      });
    }
    byContract.set(descriptor.id, property);
    byHostProperty.set(`${ownerType}::${descriptor.property ?? name}`, property);
  }
  return Object.freeze({byContract, byHostProperty});
}
