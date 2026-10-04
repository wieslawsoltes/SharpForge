import {CONTROLS} from '@sharpforge/framework';
import {designScene, propertySchema, resolvedProperties, validateDesign} from './model.js';
import {authoringError} from './property-diagnostics.js';
import {projectDesignerState} from './resource-states.js';
import {projectDesignerAuthoringScene} from './resource-preview.js';

const previewThemes = ['light', 'dark', 'highContrast'];
const previewStates = ['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused'];

function validChoices(values, choices) {
  return Array.isArray(values) && values.length > 0 && values.length <= choices.length &&
    new Set(values).size === values.length && values.every(value => choices.includes(value));
}

/** Defaults produce ten scenes; explicit distinct theme/state subsets bound gallery work and preserve caller order. */
export function designerInstancePreviews(input, {nodeId, resourceKey, kind = 'style', themes = ['light', 'dark'],
  states = ['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused'], resolveAsset} = {}) {
  if (!validChoices(themes, previewThemes) || !validChoices(states, previewStates) || !['style', 'template'].includes(kind) ||
    resolveAsset !== undefined && typeof resolveAsset !== 'function') {
    authoringError('SFD1854', 'Choose bounded preview themes and states.');
  }
  const design = validateDesign(input);
  let root = design.nodes.find(node => node.id === nodeId);
  if (!root && resourceKey) {
    const resource = kind === 'template' ? design.templates[resourceKey] : design.styles[resourceKey];
    if (!resource) authoringError('SFD1854', 'Preview resource was not found.');
    const schema = propertySchema(resource.targetType);
    root = {id: 'preview', type: resource.targetType, properties: {},
      children: [], events: {}, [kind]: resourceKey};
    const sources = resolvedProperties(design, root).sources;
    for (const [property, value] of [['Width', 160], ['Height', 48], [schema.Content ? 'Content' : 'Text', 'Preview']]) {
      if (schema[property] && !sources[property]?.startsWith('style:')) root.properties[property] = value;
    }
    if (resource.targetType === CONTROLS + 'TextBox') {
      delete root.properties.Content;
      if (!sources.Text?.startsWith('style:')) root.properties.Text = 'Preview';
    }
  }
  if (!root) authoringError('SFD1854', 'Select an instance or a resource to preview.');
  const nodes = new Map(design.nodes.map(node => [node.id, node]));
  const selected = [];
  const collect = node => {
    selected.push(structuredClone(node));
    node.children.forEach(id => collect(nodes.get(id)));
  };
  collect(root);
  const base = {...design, root: root.id, nodes: selected, width: 240, height: 150};
  delete base.designTime;
  delete base.responsive;
  for (const node of base.nodes) {
    delete node.properties.Left;
    delete node.properties.Top;
    node.events = {};
  }
  const result = [];
  for (const theme of themes) {
    for (const state of states) {
      const document = structuredClone(base);
      const instance = document.nodes[0];
      const schema = propertySchema(instance.type);
      if (schema.RequestedTheme) instance.properties.RequestedTheme = theme === 'light' ? 1 : 2;
      if (state === 'Disabled' && schema.IsEnabled) instance.properties.IsEnabled = false;
      let scene = projectDesignerAuthoringScene(document, designScene(document), {theme, samples: false});
      scene = projectDesignerState(scene, root.states, {'*': state});
      if (root.template) scene = projectDesignerState(scene, design.templates[root.template].states, {'*': state}, {prefix: root.id + '::'});
      if (resolveAsset) {
        for (const node of scene.nodes) {
          if (node.properties.Source) node.properties.Source = resolveAsset(node.properties.Source) ?? node.properties.Source;
        }
      }
      result.push({theme, state, scene});
    }
  }
  return result;
}
