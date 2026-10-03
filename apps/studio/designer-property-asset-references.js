import {DesignerAuthoringError} from '@sharpforge/designer';

/** Collects image-bearing declarations without instantiating the dictionary's serialization scaffold. */
export function designerAssetReferenceScene(design, scene = null) {
  const nodes = [];
  const seen = new Set();
  const add = (id, source) => {
    if (typeof source !== 'string' || !source || seen.has(source)) return;
    if (seen.size >= 10000) throw new DesignerAuthoringError('SFD1863', 'Image reference inventory limit.');
    seen.add(source);
    nodes.push({id, properties: {Source: source}});
  };
  const addReference = (id, reference) => {
    const resource = design.resources?.[reference?.key];
    if (!resource) return;
    const values = resource.kind === 'theme' ? Object.values(resource.variants) : [resource.value];
    for (const value of values) add(id, value);
  };
  const addStates = groups => {
    for (const group of groups ?? []) {
      for (const state of group.states) {
        for (const setter of state.setters) {
          if (setter.property === 'Source') add(setter.target, setter.value);
        }
      }
    }
  };
  for (const node of scene?.nodes ?? []) add(node.designId ?? node.id, node.properties?.Source);
  for (const [key, style] of Object.entries(design.styles ?? {})) add('style:' + key, style.setters?.Source);
  const stack = [...design.nodes, ...Object.entries(design.templates ?? {}).map(([key, template]) => ({...template.root, previewKey: key}))];
  let inspected = 0;
  while (stack.length) {
    if (++inspected > 20000) throw new DesignerAuthoringError('SFD1863', 'Image declaration traversal limit.');
    const node = stack.pop();
    const id = node.previewKey ? 'template:' + node.previewKey + ':' + node.id : node.id;
    add(id, node.properties?.Source);
    addReference(id, node.resourceReferences?.Source);
    for (const child of node.children ?? []) if (child && typeof child === 'object') stack.push(child);
    for (const items of Object.values(node.collections ?? {})) {
      for (const item of items) if (item && typeof item === 'object') add(id, item.properties?.Source);
    }
    addStates(node.states);
  }
  for (const template of Object.values(design.templates ?? {})) {
    addStates(template.states);
  }
  return {nodes};
}
