import {CONTROLS, frameworkAssignable} from '@sharpforge/framework';

/** Context affects row discovery only; authored values remain visible for inspection and reset. */
export function designerAttachedPropertyFilter(design, selected, {search = '', sourceBindings = {}, resolved = []} = {}) {
  const selectedIds = new Set(selected.map(node => node.id));
  const parentTypes = new Set();
  for (const parent of design.nodes) {
    if (parent.children.some(id => selectedIds.has(id))) parentTypes.add(parent.type);
  }
  const authored = new Set();
  for (const [index, node] of selected.entries()) {
    for (const table of [node.properties, node.bindings, node.resourceReferences, node.templatePropertyBindings,
      sourceBindings[node.id]?.properties]) {
      for (const name of Object.keys(table ?? {})) authored.add(name);
    }
    for (const [name, source] of Object.entries(resolved[index]?.sources ?? {})) {
      if (source.startsWith('style:')) authored.add(name);
    }
  }
  const searching = search.trim().length > 0;
  return function relevant(name, schema) {
    if (!schema.attached || !frameworkAssignable(CONTROLS + 'Panel', schema.owner)) return true;
    if (searching || authored.has(name)) return true;
    for (const parentType of parentTypes) {
      if (frameworkAssignable(schema.owner, parentType)) return true;
    }
    return false;
  };
}
