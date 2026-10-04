import {importDesignerAuthoringResources, importDesignerTemplateResources} from './resource-clipboard.js';
import {copyDesignerAuthoringNodeMetadata} from './resource-node-references.js';
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function reserveName(requested, used, separator = '_') {
  let candidate = requested;
  let suffix = 1;
  while (used.has(candidate)) candidate = requested + separator + suffix++;
  used.add(candidate);
  return candidate;
}

function resourceName(destination, group, key, value) {
  if (destination[group][key] && equal(destination[group][key], value)) return key;
  const occupied = candidate => Object.hasOwn(destination.styles, candidate) || Object.hasOwn(destination.templates, candidate)
    || Object.hasOwn(destination.resources ?? {}, candidate);
  let result = key;
  let serial = 1;
  while (occupied(result)) result = key + '_' + serial++;
  return result;
}

/** Copy selected subtrees in O(nodes + resources), preserving reference sharing. */
export function cloneSubtrees(source, destination, roots, { offset = 0 } = {}) {
  const originals = new Map(source.nodes.map(node => [node.id, node]));
  const ids = new Set(destination.nodes.map(node => node.id));
  const names = new Set(destination.nodes.map(node => node.properties.Name).filter(Boolean));
  const styleMap = new Map();
  const templateMap = new Map();
  const copiedIds = new Map();
  const copyStyle = key => {
    if (styleMap.has(key)) return styleMap.get(key);
    const style = structuredClone(source.styles[key]);
    if (!style) throw new TypeError('Missing clipboard style ' + key);
    if (style.basedOn) style.basedOn = copyStyle(style.basedOn);
    const target = resourceName(destination, 'styles', key, style);
    destination.styles[target] = style;
    styleMap.set(key, target);
    return target;
  };
  const copyTemplate = key => {
    if (templateMap.has(key)) return templateMap.get(key);
    const template = structuredClone(source.templates[key]);
    if (!template) throw new TypeError('Missing clipboard template ' + key);
    importDesignerTemplateResources(source, destination, template);
    const target = resourceName(destination, 'templates', key, template);
    destination.templates[target] = template;
    templateMap.set(key, target);
    return target;
  };
  const copyNode = (sourceId, root = false) => {
    const original = originals.get(sourceId);
    if (!original) throw new TypeError('Missing clipboard control ' + sourceId);
    const node = structuredClone(original);
    node.id = reserveName(sourceId + '_copy', ids);
    copiedIds.set(sourceId, node.id);
    if (node.properties.Name) node.properties.Name = reserveName(node.properties.Name + '_copy', names);
    delete node.runtimeId;
    delete node.baseProperties;
    if (node.style) node.style = copyStyle(node.style);
    if (node.template) node.template = copyTemplate(node.template);
    if (root && offset) {
      if (node.properties.Left !== undefined) node.properties.Left += offset;
      if (node.properties.Top !== undefined) node.properties.Top += offset;
    }
    importDesignerAuthoringResources(source, destination, node);
    destination.nodes.push(node);
    node.children = original.children.map(child => copyNode(child));
    return node.id;
  };
  const result = roots.map(id => copyNode(id, true));
  copyDesignerAuthoringNodeMetadata(source, destination, copiedIds);
  return result;
}
