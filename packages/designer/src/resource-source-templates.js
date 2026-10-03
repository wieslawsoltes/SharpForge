import {frameworkType} from '@sharpforge/framework';
import {normalizeProperty, propertySchema, track} from './model.js';
import {resourceAttributes, resourceChildren, resourceMarkupFail} from './resource-source-xml.js';
import {resourceElementValue, resourcePropertyName, resourcePropertyValue, resourceReference,
  resourceSetter, resourceType, resourceNumber} from './resource-source-values.js';

function partAttribute(part, name, value, node) {
  if (name === 'x:Name') return;
  if (name === 'Style' || name === 'Template') {
    part[name.toLowerCase()] = resourceReference(value, 'StaticResource', node);
    return;
  }
  const property = resourcePropertyName(part.type, name, node);
  if (value.startsWith('{TemplateBinding ')) part.bindings[property] = resourceReference(value, 'TemplateBinding', node);
  else if (value.startsWith('{StaticResource ') || value.startsWith('{ThemeResource ')) {
    const theme = value.startsWith('{ThemeResource ');
    (part.resourceReferences ??= {})[property] = {kind: theme ? 'theme' : 'static',
      key: resourceReference(value, theme ? 'ThemeResource' : 'StaticResource', node)};
  } else part.properties[property] = resourcePropertyValue(part.type, property, value, node);
}

function propertyElement(part, node) {
  const property = node.name.slice(node.name.indexOf('.') + 1);
  resourceAttributes(node, []);
  resourceChildren(node, {children: true});
  if (property === 'RowDefinitions' || property === 'ColumnDefinitions') {
    const row = property === 'RowDefinitions';
    if (part[row ? 'rows' : 'columns']) resourceMarkupFail(node, 'Duplicate template track definitions.');
    const itemName = row ? 'RowDefinition' : 'ColumnDefinition';
    const valueName = row ? 'Height' : 'Width';
    part[row ? 'rows' : 'columns'] = node.children.map(item => {
      if (item.name !== itemName) resourceMarkupFail(item, 'Unexpected grid definition type.');
      resourceAttributes(item, [valueName]);
      resourceChildren(item);
      return track(item.attributes[valueName]);
    });
    return;
  }
  if (node.children.length !== 1) resourceMarkupFail(node, 'A property element requires exactly one value.');
  if (Object.hasOwn(part.properties, property) || Object.hasOwn(part.bindings, property)) {
    resourceMarkupFail(node, `Duplicate template property ${property}.`);
  }
  part.properties[property] = normalizeProperty(part.type, property, resourceElementValue(node.children[0]).value);
}

function transition(node) {
  if (node.name !== 'VisualTransition') resourceMarkupFail(node, 'Unexpected transition element.');
  resourceAttributes(node, ['From', 'To', 'GeneratedDuration']);
  resourceChildren(node);
  const values = node.attributes.GeneratedDuration?.split(':');
  if (values?.length !== 3) resourceMarkupFail(node, 'Transitions require an explicit duration.');
  const duration = (resourceNumber(values[0], node) * 3600 + resourceNumber(values[1], node) * 60
    + resourceNumber(values[2], node)) * 1000;
  return {...(node.attributes.From ? {from: node.attributes.From} : {}),
    ...(node.attributes.To ? {to: node.attributes.To} : {}), duration};
}

function stateGroups(node, parts) {
  resourceAttributes(node, []);
  resourceChildren(node, {children: true});
  return node.children.map(group => {
    if (group.name !== 'VisualStateGroup') resourceMarkupFail(group, 'Unexpected visual state group.');
    resourceAttributes(group, ['x:Name']);
    resourceChildren(group, {children: true});
    const result = {name: group.attributes['x:Name'], states: [], transitions: []};
    let hasTransitions = false;
    for (const entry of group.children) {
      if (entry.name === 'VisualStateGroup.Transitions') {
        if (hasTransitions) resourceMarkupFail(entry, 'Duplicate visual transition collection.');
        hasTransitions = true;
        resourceAttributes(entry, []);
        resourceChildren(entry, {children: true});
        result.transitions = entry.children.map(transition);
        continue;
      }
      if (entry.name !== 'VisualState') resourceMarkupFail(entry, 'Unexpected visual state element.');
      resourceAttributes(entry, ['x:Name']);
      resourceChildren(entry, {children: true});
      const values = entry.children[0];
      if (entry.children.length !== 1 || values.name !== 'VisualState.Setters') resourceMarkupFail(entry, 'Expected one state setter list.');
      resourceAttributes(values, []);
      resourceChildren(values, {children: true});
      const setters = values.children.map(setter => {
        const target = setter.attributes.Target?.split('.')[0];
        const part = parts.get(target);
        if (!part) resourceMarkupFail(setter, 'A visual state target must name a local template part.');
        return {target: part.id, ...resourceSetter(setter, part.type, {state: true})};
      });
      result.states.push({name: entry.attributes['x:Name'], setters});
    }
    return result;
  });
}

/** Template parts and state setters remain data; handlers, external objects and markup providers are refused. */
export function decodeResourceTemplate(node) {
  resourceAttributes(node, ['x:Key', 'TargetType']);
  resourceChildren(node, {children: true});
  if (node.children.length !== 1) resourceMarkupFail(node, 'A template requires one visual root.');
  const parts = new Map();
  const pendingStates = [];
  const readPart = (element, root = false) => {
    const type = resourceType(element.name, element);
    if (!['control', 'shape'].includes(frameworkType(type).kind)) resourceMarkupFail(element, 'Template parts must be controls.');
    const id = element.attributes['x:Name'];
    if (!id || parts.has(id)) resourceMarkupFail(element, 'Every template part needs a unique x:Name.');
    const part = {id, type, properties: {Name: id}, bindings: {}, children: []};
    parts.set(id, part);
    resourceChildren(element, {children: true});
    for (const [name, value] of Object.entries(element.attributes)) partAttribute(part, name, value, element);
    for (const child of element.children) {
      if (child.name === 'VisualStateManager.VisualStateGroups') {
        if (!root || pendingStates.length) resourceMarkupFail(child, 'Template state groups belong to its one root.');
        pendingStates.push(child);
      } else if (child.name.startsWith(element.name + '.')) propertyElement(part, child);
      else part.children.push(readPart(child));
    }
    return part;
  };
  const template = {targetType: resourceType(node.attributes.TargetType, node), root: readPart(node.children[0], true)};
  if (pendingStates.length) template.states = stateGroups(pendingStates[0], parts);
  return template;
}
