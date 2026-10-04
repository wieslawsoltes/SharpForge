import {authoringError, finiteNumber} from './property-diagnostics.js';

/** Samples are stored exclusively in designTime; code generators never enumerate that namespace. */
export function setDesignerSampleData(document, id, value) {
  if (!document.node(id)) authoringError('SFD1860', 'Sample-data target was not found.');
  return document.change('Edit design-time data', design => {
    design.designTime ??= {version: 1, nodes: {}};
    if (value === null) delete design.designTime.nodes[id];
    else design.designTime.nodes[id] = structuredClone(value);
  });
}

export function createDesignerSampleItems(count = 5, {prefix = 'Sample item', start = 1} = {}) {
  count = finiteNumber(count, {label: 'Sample count', minimum: 0, maximum: 1000, integer: true});
  start = finiteNumber(start, {label: 'Starting index', minimum: 0, maximum: 1000000, integer: true});
  if (typeof prefix !== 'string' || prefix.length > 200) authoringError('SFD1860', 'Sample prefix must be bounded text.');
  return Array.from({length: count}, (_, index) => `${prefix} ${start + index}`);
}

/** Preview-only data overrides a cloned scene. Bindings remain protected, unevaluated expressions. */
export function applyDesignerSampleData(scene, design, {enabled = true} = {}) {
  if (!enabled || !design.designTime) return scene;
  const result = structuredClone(scene);
  const nodes = new Map(result.nodes.map(node => [node.id, node]));
  for (const [id, sample] of Object.entries(design.designTime.nodes)) {
    const node = nodes.get(id);
    if (!node) continue;
    Object.assign(node.properties, structuredClone(sample.properties ?? {}), structuredClone(sample.bindingValues ?? {}));
    if (sample.items) node.collections.Items = structuredClone(sample.items);
  }
  return result;
}

/** Rehydrate serializable design metadata; runtime exporters can use this explicit stripping boundary. */
export function stripDesignerOnlyData(design) {
  const result = structuredClone(design);
  delete result.designTime;
  delete result.designerOptions;
  delete result.editorState;
  return result;
}
