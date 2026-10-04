const plainPrototype = Object.prototype;

function byteView(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function capture(value, budget, ancestors, depth = 0) {
  if (--budget.values < 0 || depth > 32 || (budget.bytes -= 32) < 0) return null;
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && (budget.bytes -= value.length * 2) < 0) return null;
    return {kind: 'value', value};
  }
  const prototype = Object.getPrototypeOf(value);
  const bytes = byteView(value);
  if (bytes) {
    if ((budget.bytes -= bytes.length) < 0) return null;
    return {kind: 'bytes', prototype, bytes: bytes.slice()};
  }
  if (prototype !== plainPrototype && prototype !== null && prototype !== Array.prototype) return null;
  if (ancestors.has(value)) return null;
  ancestors.add(value);
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (budget.bytes -= key.length * 2) < 0) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const child = capture(descriptor.value, budget, ancestors, depth + 1);
    if (!child) return null;
    entries.push([key, child]);
  }
  ancestors.delete(value);
  return {kind: 'record', prototype, entries};
}

function matches(snapshot, value) {
  if (snapshot.kind === 'value') return Object.is(snapshot.value, value);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== snapshot.prototype) return false;
  if (snapshot.kind === 'bytes') {
    const bytes = byteView(value);
    if (!bytes || bytes.length !== snapshot.bytes.length) return false;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== snapshot.bytes[index]) return false;
    }
    return true;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== snapshot.entries.length) return false;
  for (let index = 0; index < keys.length; index++) {
    const [key, child] = snapshot.entries[index];
    if (keys[index] !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !matches(child, descriptor.value)) return false;
  }
  return true;
}

/**
 * Cache immutable emitted results by image identity, assembly name and exact option values.
 * Option snapshots are bounded, include copied byte views, and never stringify assembly/resource bytes.
 * Cycles, accessors, non-data objects and oversized snapshots bypass reuse without changing emission.
 * Keep at most maxNames entries per live image; each snapshot uses at most maxBytes and maxValues.
 */
export function createAssemblyArtifactCache({maxNames = 8, maxBytes = 8 * 1024 * 1024, maxValues = 250000} = {}) {
  for (const value of [maxNames, maxBytes, maxValues]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Assembly cache limits must be positive safe integers');
  }
  const images = new WeakMap();
  return {
    get(image, name, options) {
      const names = images.get(image);
      const entry = names?.get(name);
      if (!entry || !matches(entry.options, options)) return undefined;
      names.delete(name);
      names.set(name, entry);
      return entry.value;
    },
    set(image, name, options, value) {
      const snapshot = capture(options, {bytes: maxBytes, values: maxValues}, new Set());
      let names = images.get(image);
      names?.delete(name);
      if (!snapshot) return false;
      if (!names) { names = new Map(); images.set(image, names); }
      names.set(name, {options: snapshot, value});
      if (names.size > maxNames) names.delete(names.keys().next().value);
      return true;
    },
  };
}
