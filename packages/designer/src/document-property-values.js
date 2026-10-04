import {normalizeProperty, track} from './document-values.js';
import {designerPropertySchema, designerChildSlot} from './metadata.js';
import {authoringError} from './property-diagnostics.js';
import {cleanDesignData} from './document-data.js';

/** Pair the incremental property proof with the exact full validator and normalizer it complements. */
export function designerDocumentContracts(validate) {
  return {validate, normalize: normalizeProperty, childSlot: designerChildSlot, track,
    propertyPatch: {validate, normalize: normalizeProperty, schema: designerPropertySchema}};
}

export function propertyPatchEntries(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Property changes require a nodes dictionary');
  const entries = Object.entries(input);
  if (entries.length > 5000) throw new RangeError('Property target limit');
  return entries.map(([id, properties]) => {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new TypeError('Property changes require a property dictionary for ' + id);
    }
    const values = Object.entries(properties);
    if (values.length > 128) throw new RangeError('Property count limit');
    for (const [key, value] of values) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Unsafe object key');
      if (value !== undefined) cleanDesignData(value);
    }
    return [id, values.map(([key, value]) => [key, value === undefined ? undefined : structuredClone(value)])];
  });
}

export function normalizedPropertyInputs(node, entries, contracts) {
  if (!node) throw new TypeError('Unknown property target');
  const schema = contracts.propertyPatch?.schema?.(node.type);
  return entries.map(([key, value]) => {
    if (schema && (!schema[key] || schema[key].readOnly || schema[key].isStatic)) {
      throw new TypeError(`Property '${key}' is not editable on ${node.type.split('.').at(-1)}`);
    }
    if (Object.hasOwn(node.bindings ?? {}, key)) authoringError('SFD1820', `${key} has a binding and cannot take a local property edit.`);
    if (Object.hasOwn(node.resourceReferences ?? {}, key)) {
      authoringError('SFD1821', `${key} has a resource reference and cannot take a local property edit.`);
    }
    if (Object.hasOwn(node.templatePropertyBindings ?? {}, key)) {
      authoringError('SFD1840', `${key} is controlled by a template binding.`);
    }
    const normalized = value === undefined ? undefined : contracts.normalize(node.type, key, value);
    if (normalized !== undefined) cleanDesignData(normalized, 0, true);
    return [key, normalized];
  });
}

export function assertPropertyPatchPermission(entries, canEdit) {
  if (!canEdit) return;
  for (const [id, properties] of entries) {
    for (const [key] of properties) {
      if (!canEdit(id, key)) authoringError('SFD1840', `${key} is controlled by protected or locked source.`);
    }
  }
}

export function applyPropertyInputs(node, entries) {
  for (const [key, value] of entries) {
    if (value === undefined) delete node.properties[key];
    else node.properties[key] = value;
  }
}
