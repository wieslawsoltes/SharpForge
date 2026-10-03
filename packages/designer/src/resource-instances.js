import {CONTROLS} from '@sharpforge/framework';
import {designScene, propertySchema, validateDesign} from './model.js';
import {authoringError} from './property-diagnostics.js';
import {projectDesignerState} from './resource-states.js';
import {projectDesignerAuthoringScene} from './resource-preview.js';

/** Ten independent scenes share immutable authoring input: five state presets × two themes. */
export function designerInstancePreviews(input, {nodeId, resourceKey, kind = 'style', themes = ['light', 'dark'],
  states = ['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused'], resolveAsset} = {}) {
  if (!Array.isArray(themes) || !themes.length || themes.length > 2 || themes.some(theme => !['light', 'dark'].includes(theme)) ||
    !Array.isArray(states) || !states.length || states.length > 5 || states.some(state =>
      !['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused'].includes(state))) {
    authoringError('SFD1854', 'Choose bounded preview themes and states.');
  }
  const design = validateDesign(input);
  let root = design.nodes.find(node => node.id === nodeId);
  if (!root && resourceKey) {
    const resource = kind === 'template' ? design.templates[resourceKey] : design.styles[resourceKey];
    if (!resource) authoringError('SFD1854', 'Preview resource was not found.');
    const schema = propertySchema(resource.targetType);
    const properties = {};
    if (schema.Width) properties.Width = 160;
    if (schema.Height) properties.Height = 48;
    if (schema.Content) properties.Content = 'Preview';
    else if (schema.Text) properties.Text = 'Preview';
    root = {id: 'preview', type: resource.targetType, properties,
      children: [], events: {}, [kind]: resourceKey};
    if (resource.targetType === CONTROLS + 'TextBox') {
      delete root.properties.Content;
      root.properties.Text = 'Preview';
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
      let scene = projectDesignerAuthoringScene(document, designScene(document), {theme, samples: false, resolveAsset});
      scene = projectDesignerState(scene, root.states, {'*': state});
      if (root.template) scene = projectDesignerState(scene, design.templates[root.template].states, {'*': state}, {prefix: root.id + '::'});
      result.push({theme, state, scene});
    }
  }
  return result;
}
