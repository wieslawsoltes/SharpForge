import {
  ManagedFault, ReadonlySnapshotArray, snapshotFormatError, wireAtom, readWireAtom,
  ownedWireValue, restoreWireIdentity, encodeBytes, decodeBytes, constructWireView
} from './snapshot-wire-values.js';

/** Encode aliases and cycles as numbered graph edges; no executable values enter the wire form. */
export function encodeSnapshotGraph(vm, root, limits) {
  const ids = new Map();
  const pending = [];
  const nodes = [];
  let items = 0;
  let stringBytes = 0;
  let bufferBytes = 0;
  const atom = value => {
    if (++items > limits.maxItems) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot item limit exceeded');
    if (typeof value === 'string') stringBytes += value.length * 2;
    if (stringBytes > limits.maxBytes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot string limit exceeded');
    if (value === null || typeof value !== 'object') return wireAtom(value);
    if (!ids.has(value)) {
      if (pending.length >= limits.maxNodes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot node limit exceeded');
      ids.set(value, pending.length);
      pending.push(value);
    }
    return ['ref', ids.get(value)];
  };
  const rootAtom = atom(root);
  for (let index = 0; index < pending.length; index++) {
    const value = pending[index];
    if (value instanceof ArrayBuffer) {
      bufferBytes += value.byteLength;
      if (bufferBytes > limits.maxBytes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot buffer limit exceeded');
    }
    const owned = ownedWireValue(vm, value);
    nodes.push(owned ?? encodeNode(value, atom, limits));
  }
  return {root: rootAtom, nodes};
}

function propertyEntries(value, atom) {
  const entries = [];
  for (const key of Object.keys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.hasOwn(property, 'value')) {
      snapshotFormatError('SNAPSHOT_HOST_VALUE', 'Snapshot accessors cannot be serialized');
    }
    entries.push([key, atom(property.value)]);
  }
  return entries;
}

function encodeNode(value, atom, limits) {
  const frozen = Object.isFrozen(value);
  if (value instanceof ReadonlySnapshotArray) {
    const data = value.toMutableArray();
    return {kind: 'view', type: data.constructor.name, buffer: atom(data.buffer),
      offset: data.byteOffset, length: data.length, readonly: true};
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > limits.maxBytes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot buffer limit exceeded');
    return {kind: 'buffer', bytes: encodeBytes(new Uint8Array(value))};
  }
  if (ArrayBuffer.isView(value)) {
    return {kind: 'view', type: value.constructor.name, buffer: atom(value.buffer),
      offset: value.byteOffset, length: value instanceof DataView ? value.byteLength : value.length, readonly: false};
  }
  if (Array.isArray(value)) return {kind: 'array', values: Array.from(value, atom), frozen};
  if (value instanceof Map) return {kind: 'map', entries: [...value].map(([key, item]) => [atom(key), atom(item)]), frozen};
  if (value instanceof Set) return {kind: 'set', values: [...value].map(atom), frozen};
  if (value instanceof ManagedFault) {
    return {kind: 'fault', name: value.name, message: value.message, entries: propertyEntries(value, atom), frozen};
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    snapshotFormatError('SNAPSHOT_HOST_VALUE', 'Unsupported object in portable snapshot');
  }
  return {kind: 'object', entries: propertyEntries(value, atom), nullPrototype: prototype === null, frozen};
}

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireEntries(value) {
  if (!Array.isArray(value)) snapshotFormatError('SNAPSHOT_NODE', 'Snapshot entries must be an array');
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) snapshotFormatError('SNAPSHOT_NODE', 'Malformed snapshot entry');
  }
}

function allocateNode(vm, node, limits) {
  if (!plainRecord(node) || typeof node.kind !== 'string') snapshotFormatError('SNAPSHOT_NODE', 'Invalid snapshot node');
  if (node.frozen !== undefined && typeof node.frozen !== 'boolean') snapshotFormatError('SNAPSHOT_NODE', 'Invalid frozen flag');
  switch (node.kind) {
    case 'owner': case 'handle': case 'type': case 'method': case 'methodPointer': return restoreWireIdentity(vm, node);
    case 'array': case 'set': {
      if (!Array.isArray(node.values)) snapshotFormatError('SNAPSHOT_NODE', 'Invalid snapshot sequence');
      return node.kind === 'array' ? [] : new Set();
    }
    case 'map': requireEntries(node.entries); return new Map();
    case 'object':
      requireEntries(node.entries);
      if(typeof node.nullPrototype !== 'boolean') snapshotFormatError('SNAPSHOT_NODE', 'Invalid object prototype flag');
      return node.nullPrototype ? Object.create(null) : {};
    case 'fault': {
      requireEntries(node.entries);
      if (typeof node.name !== 'string' || typeof node.message !== 'string') snapshotFormatError('SNAPSHOT_NODE', 'Invalid fault');
      return new ManagedFault(node.name, node.message);
    }
    case 'buffer': return decodeBytes(node.bytes, limits.maxBytes).buffer;
    case 'view': return null;
    default: snapshotFormatError('SNAPSHOT_NODE', 'Unknown snapshot node kind');
  }
}

function defineEntries(target, entries, atom) {
  const keys = new Set();
  for (const [key, item] of entries) {
    if (typeof key !== 'string' || keys.has(key)) snapshotFormatError('SNAPSHOT_NODE', 'Invalid or duplicate property key');
    keys.add(key);
    Object.defineProperty(target, key, {value: atom(item), enumerable: true, writable: true, configurable: true});
  }
}

function populateNode(value, node, atom) {
  if (node.kind === 'array') for (const item of node.values) value.push(atom(item));
  else if (node.kind === 'set') for (const item of node.values) value.add(atom(item));
  else if (node.kind === 'map') for (const [key, item] of node.entries) value.set(atom(key), atom(item));
  else if (node.kind === 'object' || node.kind === 'fault') defineEntries(value, node.entries, atom);
  if (node.frozen) Object.freeze(value);
}

/** Construct the complete graph before the caller can replace any live VM state. */
export function decodeSnapshotGraph(vm, graph, limits) {
  if (!plainRecord(graph) || !Array.isArray(graph.nodes) || graph.nodes.length > limits.maxNodes) {
    snapshotFormatError('SNAPSHOT_GRAPH', 'Malformed or oversized snapshot graph');
  }
  let items = 0;
  let bytes = 0;
  for (const node of graph.nodes) {
    if (!plainRecord(node)) snapshotFormatError('SNAPSHOT_NODE', 'Invalid snapshot node');
    items += (node.values?.length ?? 0) + (node.entries?.length ?? 0) * 2;
    bytes += node.kind === 'buffer' ? Math.floor((node.bytes?.length ?? 0) * 3 / 4) : 0;
    if (items > limits.maxItems || bytes > limits.maxBytes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot graph limit exceeded');
  }
  const nodes = graph.nodes.map(node => allocateNode(vm, node, limits));
  const atom = value => readWireAtom(value, nodes);
  for (let index = 0; index < nodes.length; index++) {
    const node = graph.nodes[index];
    if (node.kind === 'view') nodes[index] = constructWireView(node, atom(node.buffer));
  }
  for (let index = 0; index < nodes.length; index++) populateNode(nodes[index], graph.nodes[index], atom);
  return atom(graph.root);
}
