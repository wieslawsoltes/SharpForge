import {authoringError, samePropertyValue} from './property-diagnostics.js';

/** Pure document-core hook: copied resources retain semantics without importing the model or source generator. */
export function importDesignerAuthoringResources(source, destination, node) {
  const mappings = new Map();
  const importResource = key => {
    if (mappings.has(key)) return mappings.get(key);
    const resource = source.resources?.[key];
    if (!resource) authoringError('SFD1851', `Copied resource ${key} is missing.`);
    destination.resources ??= {};
    let nextKey = key;
    let serial = 1;
    while (destination.styles[nextKey] || destination.templates[nextKey] ||
      destination.resources[nextKey] && !samePropertyValue(destination.resources[nextKey], resource)) nextKey = key + '_' + serial++;
    destination.resources[nextKey] = structuredClone(resource);
    mappings.set(key, nextKey);
    return nextKey;
  };
  for (const reference of Object.values(node.resourceReferences ?? {})) reference.key = importResource(reference.key);
  for (const binding of Object.values(node.bindings ?? {})) {
    if (binding.converter && source.resources?.[binding.converter]) binding.converter = importResource(binding.converter);
  }
  if (node.projectType) {
    const descriptor = source.projectTypes?.find(type => type.type === node.projectType);
    if (!descriptor) authoringError('SFD1851', 'Copied project control metadata is missing.');
    destination.projectTypes ??= [];
    const existing = destination.projectTypes.find(type => type.type === node.projectType);
    if (existing && !samePropertyValue(existing, descriptor)) authoringError('SFD1851', 'Copied project control metadata conflicts.');
    if (!existing) destination.projectTypes.push(structuredClone(descriptor));
  }
  return node;
}
