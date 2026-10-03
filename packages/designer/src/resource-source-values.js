import {MEDIA, XAML, canonicalType, frameworkType} from '@sharpforge/framework';
import {normalizeProperty, propertySchema, track} from './model.js';
import {normalizeDesignerBrush} from './property-values.js';
import {resourceAttributes, resourceChildren, resourceMarkupFail} from './resource-source-xml.js';

export function resourceNumber(text, node) {
  if (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim())) {
    resourceMarkupFail(node, 'A finite resource number is required.');
  }
  const value = Number(text);
  if (!Number.isFinite(value)) resourceMarkupFail(node, 'Resource number is not finite.');
  return value;
}

export function resourceType(name, node) {
  const type = canonicalType(name);
  if (!frameworkType(type)) resourceMarkupFail(node, `Unsupported resource target type ${name}.`);
  return type;
}

/** Decode property values using the same schema and normalizer as the property editor. */
export function resourcePropertyValue(type, property, text, node) {
  const schema = propertySchema(type)[property];
  if (!schema) resourceMarkupFail(node, `Unknown ${type} property ${property}.`);
  if (text === '{x:Null}') return normalizeProperty(type, property, null);
  if (text.startsWith('{}')) text = text.slice(2);
  else if (text.startsWith('{')) resourceMarkupFail(node, 'Unknown markup extension is protected.');
  const enumeration = frameworkType(schema.type);
  let value = text;
  if (schema.type === 'bool') {
    if (!['true', 'false', 'True', 'False'].includes(text)) resourceMarkupFail(node, 'Expected a Boolean resource value.');
    value = text.toLowerCase() === 'true';
  } else if (enumeration?.kind === 'enum') {
    if (!Object.hasOwn(enumeration.values, text)) resourceMarkupFail(node, `Unknown enum value ${text}.`);
    value = enumeration.values[text];
  } else if (['int', 'double'].includes(schema.type)) value = resourceNumber(text, node);
  return normalizeProperty(type, property, value);
}

export function resourcePropertyName(type, name, node) {
  if (!name.includes('.')) return name;
  for (const [property, schema] of Object.entries(propertySchema(type))) {
    if (schema.attached && `${schema.owner?.split('.').at(-1)}.${schema.member ?? property}` === name) return property;
  }
  resourceMarkupFail(node, `Unknown attached property ${name}.`);
}

function point(text, node) {
  const parts = text?.split(',');
  if (parts?.length !== 2) resourceMarkupFail(node, 'Gradient points require two coordinates.');
  return {X: resourceNumber(parts[0], node), Y: resourceNumber(parts[1], node)};
}

/** Only the non-executing value elements emitted by generateDesignResourceXaml are accepted. */
export function resourceElementValue(node) {
  const attributes = node.attributes;
  if (node.name === 'SolidColorBrush') {
    resourceAttributes(node, ['x:Key', 'Color', 'Opacity']);
    resourceChildren(node);
    const value = normalizeDesignerBrush(attributes.Color);
    if (attributes.Opacity !== undefined) value.Opacity = resourceNumber(attributes.Opacity, node);
    return {type: MEDIA + 'Brush', value: normalizeDesignerBrush(value)};
  }
  if (node.name === 'LinearGradientBrush') {
    resourceAttributes(node, ['x:Key', 'StartPoint', 'EndPoint', 'Opacity']);
    resourceChildren(node, {children: true});
    const stops = node.children.map(stop => {
      if (stop.name !== 'GradientStop') resourceMarkupFail(stop, 'Only GradientStop children are supported.');
      resourceAttributes(stop, ['Color', 'Offset']);
      resourceChildren(stop);
      return {Color: stop.attributes.Color, Offset: resourceNumber(stop.attributes.Offset, stop)};
    });
    return {type: MEDIA + 'Brush', value: normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
      StartPoint: point(attributes.StartPoint ?? '0,0', node), EndPoint: point(attributes.EndPoint ?? '1,1', node),
      Opacity: resourceNumber(attributes.Opacity ?? '1', node), GradientStops: stops})};
  }
  resourceAttributes(node, ['x:Key']);
  resourceChildren(node, {text: true});
  const text = node.text;
  if (node.name === 'x:String') return {type: 'string', value: text};
  if (node.name === 'x:Boolean') {
    if (!['true', 'false'].includes(text)) resourceMarkupFail(node, 'Invalid Boolean resource.');
    return {type: 'bool', value: text === 'true'};
  }
  if (node.name === 'x:Int32' || node.name === 'x:Double') {
    return {type: node.name === 'x:Int32' ? 'int' : 'double', value: resourceNumber(text, node)};
  }
  if (node.name === 'Thickness') return {type: XAML + 'Thickness', value: normalizeProperty('Border', 'Padding', text)};
  if (node.name === 'CornerRadius') return {type: XAML + 'CornerRadius', value: normalizeProperty('Border', 'CornerRadius', text)};
  if (node.name === 'GridLength') return {type: XAML + 'GridLength', value: track(text)};
  resourceMarkupFail(node, `Unsupported resource element ${node.name}.`);
}

export function resourceReference(text, kind, node) {
  const prefix = '{' + kind + ' ';
  if (!text?.startsWith(prefix) || !text.endsWith('}')) resourceMarkupFail(node, `Expected a ${kind} reference.`);
  const key = text.slice(prefix.length, -1);
  if (!/^[A-Za-z_]\w*$/.test(key)) resourceMarkupFail(node, 'Resource references require an identifier key.');
  return key;
}

export function resourceSetter(node, targetType, {state = false} = {}) {
  if (node.name !== 'Setter') resourceMarkupFail(node, 'Only Setter entries are supported.');
  resourceAttributes(node, [state ? 'Target' : 'Property', 'Value']);
  resourceChildren(node, {children: true});
  const address = node.attributes[state ? 'Target' : 'Property'];
  if (!address) resourceMarkupFail(node, 'Setter property is required.');
  const property = resourcePropertyName(targetType, state ? address.slice(address.indexOf('.') + 1) : address, node);
  if (node.attributes.Value !== undefined) {
    if (node.children.length) resourceMarkupFail(node, 'Setter has more than one value.');
    return {property, value: resourcePropertyValue(targetType, property, node.attributes.Value, node)};
  }
  const child = node.children[0];
  if (node.children.length !== 1 || child.name !== 'Setter.Value' || child.children.length !== 1) {
    resourceMarkupFail(node, 'Setter requires one value.');
  }
  resourceAttributes(child, []);
  resourceChildren(child, {children: true});
  return {property, value: normalizeProperty(targetType, property, resourceElementValue(child.children[0]).value)};
}
