const controllerProperties = ['HorizontalScrollController', 'VerticalScrollController'];
const pointCollections = ['HorizontalSnapPoints', 'VerticalSnapPoints', 'ZoomSnapPoints'];

/** Empty presenter defaults do not hide the outer ScrollView's explicitly configured controllers and snap collections. */
export function scrollConfiguration(node, owner) {
  if (!owner) return node;
  const properties = { ...owner.properties, ...node.properties };
  for (const property of controllerProperties) properties[property] = node.properties[property] ?? owner.properties[property];
  const collections = { ...owner.collections, ...node.collections };
  for (const property of pointCollections) {
    const own = node.collections?.[property] ?? node.properties[property];
    const outer = owner.collections?.[property] ?? owner.properties[property];
    collections[property] = Array.isArray(own) && own.length ? own : outer ?? own ?? [];
  }
  return { ...node, properties, collections };
}
