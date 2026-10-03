const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function reserveName(requested, used, separator = '_') {
  let candidate = requested;
  let suffix = 1;
  while (used.has(candidate)) candidate = requested + separator + suffix++;
  used.add(candidate);
  return candidate;
}

/** Copy selected subtrees in O(nodes + resources), preserving reference sharing. */
export function cloneSubtrees(source, destination, roots, { offset = 0 } = {}) {
  const originals = new Map(source.nodes.map(node => [node.id, node]));
  const ids = new Set(destination.nodes.map(node => node.id));
  const names = new Set(destination.nodes.map(node => node.properties.Name).filter(Boolean));
  const styleMap = new Map();
  const templateMap = new Map();
  const styleNames = new Set(Object.keys(destination.styles));
  const templateNames = new Set(Object.keys(destination.templates));
  const copyStyle = key => {
    if (styleMap.has(key)) return styleMap.get(key);
    const style = structuredClone(source.styles[key]);
    if (!style) throw new TypeError('Missing clipboard style ' + key);
    if (style.basedOn) style.basedOn = copyStyle(style.basedOn);
    const target = !destination.styles[key] || equal(destination.styles[key], style)
      ? key : reserveName(key, styleNames);
    styleNames.add(target);
    destination.styles[target] = style;
    styleMap.set(key, target);
    return target;
  };
  const copyTemplate = key => {
    if (templateMap.has(key)) return templateMap.get(key);
    const template = structuredClone(source.templates[key]);
    if (!template) throw new TypeError('Missing clipboard template ' + key);
    const target = !destination.templates[key] || equal(destination.templates[key], template)
      ? key : reserveName(key, templateNames);
    templateNames.add(target);
    destination.templates[target] = template;
    templateMap.set(key, target);
    return target;
  };
  const copyNode = (sourceId, root = false) => {
    const original = originals.get(sourceId);
    if (!original) throw new TypeError('Missing clipboard control ' + sourceId);
    const node = structuredClone(original);
    node.id = reserveName(sourceId + '_copy', ids);
    if (node.properties.Name) node.properties.Name = reserveName(node.properties.Name + '_copy', names);
    delete node.runtimeId;
    if (node.style) node.style = copyStyle(node.style);
    if (node.template) node.template = copyTemplate(node.template);
    if (root && offset) {
      if (node.properties.Left !== undefined) node.properties.Left += offset;
      if (node.properties.Top !== undefined) node.properties.Top += offset;
    }
    destination.nodes.push(node);
    node.children = original.children.map(child => copyNode(child));
    return node.id;
  };
  return roots.map(id => copyNode(id, true));
}
