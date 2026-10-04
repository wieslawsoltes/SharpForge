import {PropertyFault} from './values.js';

const identity = value => value;
const maximumCallbacks = 100000;
const fail = message => { throw new PropertyFault('ArgumentException', message); };

/** In-memory snapshots contain stable property/token IDs and host-encoded values. */
export function snapshotPropertyStore(store, {encode = identity} = {}) {
  return {
    version: 1,
    ownerType: store.ownerType,
    nextToken: store.nextToken,
    parentOwner: encode(store.parent?.owner ?? null),
    listeners: [...store.listeners].map(([token, callback]) => [token, encode(callback)]),
    entries: [...store.entries.values()].map(entry => ({
      property: entry.property.id,
      defaultValue: encode(entry.defaultValue),
      slots: [...entry.slots].map(([source, value]) => [source, encode(value)]),
      callbacks: [...entry.callbacks].map(([token, subscription]) => [token, {
        callback: encode(subscription.callback), registered: subscription.registered
      }])
    }))
  };
}

function decodeCallbacks(rows, decode, tokens, nextToken, registered) {
  if (!Array.isArray(rows) || rows.length > maximumCallbacks) fail('Property callback snapshot limit exceeded');
  const callbacks = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2) fail('Malformed callback snapshot row');
    const [token, value] = row;
    if (!Number.isSafeInteger(token) || token < 1 || token >= nextToken || tokens.has(token)) fail('Invalid callback token');
    if (tokens.size >= maximumCallbacks) fail('Property callback snapshot limit exceeded');
    tokens.add(token);
    if (registered) {
      if (!value || typeof value.registered !== 'boolean') fail('Malformed callback snapshot value');
      callbacks.set(token, {callback: decode(value.callback), registered: value.registered});
    } else callbacks.set(token, decode(value));
  }
  return callbacks;
}

/** Validate before committing; snapshot restore never calls user factories or callbacks. */
export function restorePropertyStore(store, snapshot, {decode = identity, resolveParent} = {}) {
  if (snapshot?.version !== 1 || snapshot.ownerType !== store.ownerType || !Array.isArray(snapshot.entries)) {
    fail('Invalid property store snapshot');
  }
  if (snapshot.entries.length > store.registry.maxProperties || !Number.isSafeInteger(snapshot.nextToken) || snapshot.nextToken < 1) {
    fail('Property store snapshot limit exceeded');
  }
  const tokens = new Set();
  const restored = new Map();
  for (const value of snapshot.entries) {
    const property = store.registry.identities.get(value.property);
    store.assertProperty(property);
    if (restored.has(property.id) || !Array.isArray(value.slots) || value.slots.length > 9) fail('Malformed snapshot property');
    const slots = new Map();
    for (const [source, item] of value.slots) {
      store.assertSource(source);
      if (slots.has(source)) fail('Duplicate snapshot value source');
      slots.set(source, decode(item));
    }
    const callbacks = decodeCallbacks(value.callbacks ?? [], decode, tokens, snapshot.nextToken, true);
    restored.set(property.id, {property, slots, defaultValue: decode(value.defaultValue), callbacks});
  }
  const listeners = decodeCallbacks(snapshot.listeners ?? [], decode, tokens, snapshot.nextToken, false);
  let parent = store.parent;
  if (resolveParent) {
    parent = resolveParent(decode(snapshot.parentOwner));
    if (parent && (parent.registry !== store.registry || parent.disposed)) fail('Invalid snapshot inheritance parent');
    let current = parent;
    let depth = 0;
    while (current) {
      if (current === store || ++depth > 1024) fail('Snapshot inheritance cycle');
      current = current.parent;
    }
  }
  store.entries = restored;
  store.listeners = listeners;
  store.nextToken = snapshot.nextToken;
  store.changes.clear();
  store.parent?.children.delete(store);
  store.parent = parent;
  parent?.children.add(store);
  for (const entry of restored.values()) store.evaluate(entry);
}
