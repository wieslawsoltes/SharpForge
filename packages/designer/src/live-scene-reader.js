import {LiveDesignCapabilityError} from './live-capabilities.js';

function unsupported(message, runtimeId) {
  throw new LiveDesignCapabilityError([{
    code: 'SFDL0010', severity: 'error', source: 'Designer', span: null, capability: 'scene.collection', runtimeId,
    message, fixHint: 'Use scalar Items or controls with closed scalar properties for live collection authoring.'
  }]);
}

/** Read one managed scene without executing application code or losing scalar/object Items entries. */
export function readLiveDesignScene(scene, {name = 'Live application', collectionOwners} = {}, services) {
  if (!Array.isArray(scene?.nodes) || scene.nodes.length > 10_000 || !Array.isArray(scene.windows) || !scene.windows.length) {
    throw new TypeError('Invalid or oversized running scene');
  }
  const source = new Map();
  for (const node of scene.nodes) {
    if (!node || source.has(node.id)) throw new TypeError('Running scene identities must be unique');
    source.set(node.id, node);
  }
  const controls = new Set(services.controls.map(control => control.type));
  const expectedCollections = new Set((collectionOwners ?? []).map(owner => JSON.stringify([owner.type, owner.name ?? ''])));
  const nodes = [];
  const usedNames = new Set();
  const identities = new Map();
  const templates = {};
  let serial = 0;

  const supportedProperties = node => {
    const properties = {};
    for (const [property, value] of Object.entries(node.properties ?? {})) {
      if (['Style', 'Template', 'Child'].includes(property) || property === 'Content' && value?.$ref) continue;
      if (value === null || ['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight'].includes(property) && !Number.isFinite(value)) {
        continue;
      }
      try { properties[property] = services.normalize(node.type, property, value); }
      catch { /* Read-only and unsupported reference properties are not editable designer values. */ }
    }
    return properties;
  };

  const ownedChildren = node => {
    const slot = services.childSlot(node.type);
    if (!slot) return [];
    const values = slot.many ? node.collections?.[slot.property] ?? [] : [node.properties?.[slot.property]];
    if (!Array.isArray(values)) throw new TypeError('Invalid running child collection');
    return values.filter(value => value && Object.hasOwn(value, '$ref')).map(value => value.$ref);
  };

  function readItems(owner) {
    const expected = expectedCollections.has(JSON.stringify([owner.type, owner.properties?.Name ?? '']));
    if (!Object.hasOwn(owner.collections ?? {}, 'Items') && !expected) return null;
    const values = owner.collections?.Items ?? [];
    if (!Array.isArray(values) || values.length > 1000) unsupported('The running Items collection exceeds the authoring limit.', owner.id);
    const hasScalars = values.some(value => value === null || typeof value !== 'object');
    if (collectionOwners !== undefined && !expected && !hasScalars) return null;
    const result = [];
    for (const value of values) {
      if (typeof value === 'bigint') unsupported('A running Items integer exceeds the lossless designer numeric range.', owner.id);
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        result.push(value);
        continue;
      }
      const item = value && Object.hasOwn(value, '$ref') ? source.get(value.$ref) : null;
      if (!item) unsupported('The running Items collection contains an unsupported value object.', owner.id);
      if (ownedChildren(item).length || item.templateRoot) {
        if (!expected && !hasScalars) return null;
        unsupported('Mixed scalar Items and controls with nested visual trees cannot be captured as a closed Items collection.', owner.id);
      }
      result.push({type: item.type, properties: supportedProperties(item)});
    }
    return result;
  }

  function templatePart(runtimeId, seen = new Set(), depth = 0) {
    if (seen.has(runtimeId) || seen.size >= 500 || depth > 50) throw new TypeError('Template visual cycle or size limit');
    seen.add(runtimeId);
    const node = source.get(runtimeId);
    if (!node) throw new TypeError('Missing template visual');
    const properties = supportedProperties(node);
    const bindings = node.templateBindings ?? {};
    for (const property of Object.keys(bindings)) delete properties[property];
    return {
      id: 'part_' + seen.size, type: node.type, properties, bindings,
      children: ownedChildren(node).map(id => templatePart(id, seen, depth + 1))
    };
  }

  function walk(runtimeId, depth = 0) {
    if (depth > 100) throw new TypeError('Running visual tree exceeds the designer depth limit');
    if (identities.has(runtimeId)) return identities.get(runtimeId);
    const node = source.get(runtimeId);
    if (!node || !controls.has(node.type)) return null;
    const id = 'live_' + (++serial);
    identities.set(runtimeId, id);
    const properties = {};
    const baseProperties = {};
    for (const [property, value] of Object.entries(supportedProperties(node))) {
      const values = node.localProperties && !node.localProperties.includes(property) ? baseProperties : properties;
      values[property] = value;
    }
    if (properties.Name && usedNames.has(properties.Name)) delete properties.Name;
    if (properties.Name) usedNames.add(properties.Name);
    const item = {id, runtimeId, type: node.type, properties, baseProperties, children: [], events: {}};
    nodes.push(item);
    const items = readItems(node);
    if (items !== null) item.collections = {Items: items};
    else item.children = ownedChildren(node).map(child => walk(child, depth + 1)).filter(Boolean);
    for (const [axis, property, member] of [['rows', 'RowDefinitions', 'Height'], ['columns', 'ColumnDefinitions', 'Width']]) {
      if (node.collections?.[property]) item[axis] = node.collections[property].map(value => source.get(value.$ref)?.properties[member]).filter(Boolean);
    }
    if (node.templateRoot) {
      const key = 'LiveTemplate_' + id;
      templates[key] = {targetType: node.type, root: templatePart(node.templateRoot)};
      item.template = key;
    }
    return id;
  }

  const root = walk(scene.windows[0]);
  if (!root) throw new TypeError('Run a managed WinUI application first');
  return services.validate({version: 1, name, width: 960, height: 640, root, nodes, styles: {}, templates});
}
