import {authoringError, samePropertyValue} from './property-diagnostics.js';

function resourceImporter(source, destination) {
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
  return importResource;
}

function importNodeReferences(node, importResource, source) {
  for (const reference of Object.values(node.resourceReferences ?? {})) reference.key = importResource(reference.key);
  for (const binding of Object.values(node.bindings ?? {})) {
    if (binding.converter && source.resources?.[binding.converter]) binding.converter = importResource(binding.converter);
  }
}

/** Run on a cloned template before comparing keys, so imported references cannot alter an existing destination template. */
export function importDesignerTemplateResources(source, destination, template) {
  const importResource = resourceImporter(source, destination);
  const visit = part => {
    importNodeReferences(part, importResource, source);
    (part.children ?? []).forEach(visit);
  };
  visit(template.root);
  return template;
}

/** Pure document-core hook: copied resources retain semantics without importing the model or source generator. */
export function importDesignerAuthoringResources(source, destination, node) {
  importNodeReferences(node, resourceImporter(source, destination), source);
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
