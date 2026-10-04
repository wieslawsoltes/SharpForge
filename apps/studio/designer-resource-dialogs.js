import {
  DesignerStyleCommands, designerMetadata, designerPropertySchema, formatDesignerProperty, normalizeDesignerBrush
} from '../../packages/designer/src/index.js';
import {MEDIA} from '../../packages/framework/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect} from './designer-property-dom.js';
import {isDesignerResourceDocument} from './designer-resource-context.js';

function resourceTargetTypes(property) {
  return designerMetadata.filter(item => designerPropertySchema(item.type)[property]);
}

function openDictionaryStyle(controller) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create style resource');
  const types = resourceTargetTypes('Style');
  const key = propertyInput(document, {value: 'ControlStyle', label: 'Style key'});
  const target = propertySelect(document, types.map(type => ({value: type.type, label: type.name})), types[0].type, 'Style target');
  modal.body.append(propertyField(document, 'Key', key), propertyField(document, 'Target', target));
  modal.footer.append(propertyButton(document, 'Create style', () => modal.run(() => {
    const model = controller.view.document;
    if (model.value.resources?.[key.value] || model.value.styles[key.value] || model.value.templates[key.value]) {
      throw new Error('Resource key already exists.');
    }
    model.setStyle(key.value, {targetType: target.value, setters: {}});
    controller.selectedKey = key.value;
    controller.render();
    modal.close();
  })));
  return modal;
}

export function openCreateDesignerStyle(controller) {
  if (isDesignerResourceDocument(controller.view)) return openDictionaryStyle(controller);
  const model = controller.view.document;
  const node = model.node();
  if (!node) throw new Error('Select a control before creating a style.');
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create style from selection');
  const key = propertyInput(document, {value: (node.properties.Name || node.type.split('.').at(-1)) + 'Style', label: 'Style key'});
  modal.body.append(propertyField(document, 'Key', key));
  const schema = designerPropertySchema(node.type);
  const selected = [];
  for (const property of Object.keys(node.properties).filter(name => name !== 'Name' && !schema[name]?.attached)) {
    const input = propertyInput(document, {type: 'checkbox', label: property});
    input.checked = true;
    selected.push({property, input});
    modal.body.append(propertyField(document, property + ': ' + formatDesignerProperty(node.properties[property]), input));
  }
  modal.footer.append(propertyButton(document, 'Create and apply', () => modal.run(() => {
    new DesignerStyleCommands(model).createFromSelection(key.value, {properties: selected.filter(item => item.input.checked).map(item => item.property)});
    controller.selectedKey = key.value;
    modal.close();
  })));
}

export function openDesignerResourceName(controller, title, initial, apply) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, title);
  const key = propertyInput(document, {value: initial, label: 'Resource key'});
  modal.body.append(propertyField(document, 'Key', key));
  modal.footer.append(propertyButton(document, 'Apply', () => modal.run(() => { apply(key.value); modal.close(); })));
  return modal;
}

export function openCreateDesignerBrush(controller) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create brush resource');
  const key = propertyInput(document, {value: 'AccentBrush', label: 'Resource key'});
  const color = propertyInput(document, {value: '#0078d4', label: 'Color hex'});
  const theme = propertyInput(document, {type: 'checkbox', label: 'Theme resource'});
  modal.body.append(propertyField(document, 'Key', key), propertyField(document, 'Color', color), propertyField(document, 'Theme', theme));
  modal.footer.append(propertyButton(document, 'Create brush', () => modal.run(() => {
    controller.view.document.change('Create brush resource', design => {
      if (design.resources?.[key.value] || design.styles[key.value] || design.templates[key.value]) throw new Error('Resource key already exists.');
      const value = normalizeDesignerBrush(color.value);
      (design.resources ??= {})[key.value] = theme.checked ? {kind: 'theme', type: MEDIA + 'Brush', variants: {default: value}} :
        {kind: 'value', type: MEDIA + 'Brush', value};
    });
    controller.selectedKey = key.value;
    modal.close();
  })));
}

export function openCreateDesignerTemplate(controller) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create control template');
  const key = propertyInput(document, {value: 'ControlTemplate', label: 'Template key'});
  const types = resourceTargetTypes('Template');
  const selectedType = controller.view.document.node()?.type;
  const type = propertySelect(document, types.map(item => ({value: item.type, label: item.name})),
    types.some(item => item.type === selectedType) ? selectedType : types[0].type, 'Template target');
  modal.body.append(propertyField(document, 'Key', key), propertyField(document, 'Target', type));
  modal.footer.append(propertyButton(document, 'Create template', () => modal.run(() => {
    const schema = designerPropertySchema(type.value);
    const child = schema.Content ? {id: 'presenter', type: 'ContentPresenter', properties: {}, bindings: {Content: 'Content'}, children: []} :
      {id: 'label', type: 'TextBlock', properties: {Text: 'Template'}, bindings: {}, children: []};
    controller.view.document.setTemplate(key.value, {targetType: type.value,
      root: {id: 'frame', type: 'Border', properties: {Padding: 8}, bindings: {}, children: [child]}});
    controller.selectedKey = key.value;
    modal.close();
    controller.enterTemplate(key.value);
  })));
}
