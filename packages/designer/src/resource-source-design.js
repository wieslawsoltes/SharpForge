import {createDesignerResourceDocument} from './resource-documents.js';
import {parseResourceMarkup, resourceAttributes, resourceChildren, resourceMarkupFail} from './resource-source-xml.js';
import {resourceElementValue, resourceReference, resourceSetter, resourceType} from './resource-source-values.js';
import {decodeResourceTemplate} from './resource-source-templates.js';

function keyOf(node) {
  const key = node.attributes['x:Key'];
  if (!key || !/^[A-Za-z_]\w*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
    resourceMarkupFail(node, 'Resource keys must be safe identifiers.');
  }
  return key;
}

function decodeStyle(node) {
  resourceAttributes(node, ['x:Key', 'TargetType', 'BasedOn']);
  resourceChildren(node, {children: true});
  const targetType = resourceType(node.attributes.TargetType, node);
  const setters = {};
  for (const child of node.children) {
    const setter = resourceSetter(child, targetType);
    if (Object.hasOwn(setters, setter.property)) resourceMarkupFail(child, 'Duplicate style setter.');
    setters[setter.property] = setter.value;
  }
  return {targetType, setters, ...(node.attributes.BasedOn
    ? {basedOn: resourceReference(node.attributes.BasedOn, 'StaticResource', node)} : {})};
}

function decodeThemes(node, resources, reserve) {
  resourceAttributes(node, []);
  resourceChildren(node, {children: true});
  const themes = {Default: 'default', Light: 'light', Dark: 'dark', HighContrast: 'highContrast'};
  const seen = new Set();
  for (const dictionary of node.children) {
    if (dictionary.name !== 'ResourceDictionary') resourceMarkupFail(dictionary, 'Expected a theme resource dictionary.');
    resourceAttributes(dictionary, ['x:Key']);
    resourceChildren(dictionary, {children: true});
    const theme = themes[dictionary.attributes['x:Key']];
    if (!theme || seen.has(theme)) resourceMarkupFail(dictionary, 'Unknown or duplicate theme dictionary.');
    seen.add(theme);
    const keys = new Set();
    for (const child of dictionary.children) {
      const key = keyOf(child);
      if (keys.has(key)) resourceMarkupFail(child, 'Duplicate theme resource key.');
      keys.add(key);
      const {type, value} = resourceElementValue(child);
      if (!Object.hasOwn(resources, key)) {
        reserve(key, child);
        resources[key] = {kind: 'theme', type, variants: {}};
      }
      const entry = resources[key];
      if (entry.kind !== 'theme' || entry.type !== type) resourceMarkupFail(child, 'Theme resource types must agree.');
      entry.variants[theme] = value;
    }
  }
}

/** Read only the resource markup emitted by this designer; unsupported data is never silently discarded. */
export function decodeDesignerResourceMarkup(text, {name = 'DesignerResources', ...options} = {}) {
  const root = parseResourceMarkup(text, options);
  if (root.name !== 'ResourceDictionary') resourceMarkupFail(root, 'Expected a ResourceDictionary root.');
  resourceAttributes(root, ['xmlns', 'xmlns:x']);
  if (root.attributes.xmlns !== 'http://schemas.microsoft.com/winfx/2006/xaml/presentation'
    || root.attributes['xmlns:x'] !== 'http://schemas.microsoft.com/winfx/2006/xaml') {
    resourceMarkupFail(root, 'Only the generated Microsoft WinUI resource namespaces are supported.');
  }
  resourceChildren(root, {children: true});
  const resources = {};
  const styles = {};
  const templates = {};
  const implicit = [];
  const reserved = new Set();
  const reserve = (key, node) => {
    if (reserved.has(key)) resourceMarkupFail(node, `Duplicate resource key ${key}.`);
    reserved.add(key);
  };
  let hasThemes = false;
  for (const node of root.children) {
    if (node.name === 'ResourceDictionary.ThemeDictionaries') {
      if (hasThemes) resourceMarkupFail(node, 'Duplicate theme dictionary collection.');
      hasThemes = true;
      decodeThemes(node, resources, reserve);
      continue;
    }
    if (node.name === 'Style' && !node.attributes['x:Key']) {
      implicit.push({node, style: decodeStyle(node)});
      continue;
    }
    const key = keyOf(node);
    reserve(key, node);
    if (node.name === 'Style') styles[key] = decodeStyle(node);
    else if (node.name === 'ControlTemplate') templates[key] = decodeResourceTemplate(node);
    else resources[key] = {kind: 'value', ...resourceElementValue(node)};
  }
  for (const {node, style} of implicit) {
    const target = styles[style.basedOn];
    if (!target || target.implicit || target.targetType !== style.targetType || Object.keys(style.setters).length) {
      resourceMarkupFail(node, 'An implicit style must refer to one keyed style of the same target type.');
    }
    target.implicit = true;
  }
  const document = createDesignerResourceDocument({name, resources, styles, templates});
  try { return document.snapshot(); }
  finally { document.dispose(); }
}
