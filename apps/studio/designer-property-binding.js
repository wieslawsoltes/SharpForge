import {frameworkAssignable} from '../../packages/framework/src/index.js';
import {designerPropertySchema} from '../../packages/designer/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect} from './designer-property-dom.js';

/** Structured binding settings preserve protected expressions; no converter or binding is executed here. */
export function openDesignerBindingEditor(context, {resource = false} = {}) {
  const document = context.document;
  const modal = propertyDialog(document, (resource ? 'Resource for ' : 'Binding for ') + context.name);
  if (resource) renderResourceReference(modal, context);
  else renderBinding(modal, context);
  return modal;
}

function renderBinding(modal, context) {
  const binding = context.modelDocument.node(context.ids[0]).bindings?.[context.name] ?? {path: '', mode: 'OneWay'};
  const path = propertyInput(context.document, {value: binding.path, label: 'Binding path'});
  const mode = propertySelect(context.document, ['OneTime', 'OneWay', 'TwoWay'], binding.mode, 'Binding mode');
  const converter = propertyInput(context.document, {value: binding.converter ?? '', label: 'Converter resource key'});
  const parameter = propertyInput(context.document, {value: binding.converterParameter ?? '', label: 'Converter parameter'});
  const element = propertyInput(context.document, {value: binding.elementName ?? '', label: 'Element name'});
  modal.body.append(propertyField(context.document, 'Path', path), propertyField(context.document, 'Mode', mode),
    propertyField(context.document, 'Converter resource', converter), propertyField(context.document, 'Converter parameter', parameter),
    propertyField(context.document, 'Element name', element),
    propertyElement(context.document, 'p', 'Bindings are preserved as source expressions. Design view does not execute application bindings or converters.'));
  modal.footer.append(propertyButton(context.document, 'Apply binding', () => modal.run(() => {
    const value = {path: path.value, mode: mode.value};
    if (converter.value.trim()) value.converter = converter.value.trim();
    if (parameter.value) value.converterParameter = parameter.value;
    if (element.value.trim()) value.elementName = element.value.trim();
    context.commands.bind(context.name, value, context.ids);
    modal.close();
  })));
}

function renderResourceReference(modal, context) {
  const reference = context.modelDocument.node(context.ids[0]).resourceReferences?.[context.name];
  const resources = Object.entries(context.modelDocument.value.resources ?? {}).filter(([, value]) =>
    context.schema.type === value.type || context.schema.type === 'object' || frameworkAssignable(context.schema.type, value.type));
  const mode = propertySelect(context.document, [{value: 'static', label: 'Static resource'}, {value: 'theme', label: 'Theme resource'}],
    reference?.kind ?? 'static', 'Resource reference kind');
  const key = propertySelect(context.document, resources.map(([value, resource]) => ({value, label: `${value} (${resource.type.split('.').at(-1)})`})),
    reference?.key ?? resources[0]?.[0], 'Resource key');
  modal.body.append(propertyField(context.document, 'Kind', mode), propertyField(context.document, 'Compatible resource', key));
  if (!resources.length) modal.body.append(propertyElement(context.document, 'p', 'Create a compatible value in Resources or use Convert to resource.'));
  modal.footer.append(propertyButton(context.document, 'Apply reference', () => modal.run(() => {
    context.commands.reference(context.name, {kind: mode.value, key: key.value}, context.ids);
    modal.close();
  }), {disabled: !resources.length}));
}

export function openDesignerConvertResource(context) {
  const modal = propertyDialog(context.document, 'Convert ' + context.name + ' to resource');
  const name = propertyInput(context.document, {value: context.name + 'Resource', label: 'Resource key'});
  const theme = propertyInput(context.document, {type: 'checkbox', label: 'Theme resource'});
  modal.body.append(propertyField(context.document, 'Key', name), propertyField(context.document, 'Theme resource', theme));
  modal.footer.append(propertyButton(context.document, 'Convert', () => modal.run(() => {
    context.commands.convertToResource(context.name, name.value.trim(), {ids: context.ids, theme: theme.checked});
    modal.close();
  })));
  return modal;
}

export function openDesignerTemplateBinding(context) {
  const scope = context.view.resources?.scope;
  if (!scope) throw new Error('Enter a template scope before editing TemplateBinding.');
  const modal = propertyDialog(context.document, 'Template binding for ' + context.name);
  const compatible = Object.entries(designerPropertySchema(scope.targetType)).filter(([, schema]) =>
    !schema.isStatic && (schema.type === context.schema.type || context.schema.type === 'object'));
  const node = scope.document.node(context.ids[0]);
  const source = propertySelect(context.document, [{value: '', label: '(No template binding)'},
    ...compatible.map(([name]) => ({value: name, label: name}))], node.templatePropertyBindings?.[context.name] ?? '', 'Owner property');
  modal.body.append(propertyField(context.document, 'Templated parent property', source));
  modal.footer.append(propertyButton(context.document, 'Apply template binding', () => modal.run(() => {
    if (context.ids.length !== 1) throw new Error('Select one template part to edit its binding.');
    scope.setBinding(context.ids[0], context.name, source.value);
    modal.close();
  })));
  return modal;
}
