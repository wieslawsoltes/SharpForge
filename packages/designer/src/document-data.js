const dangerous = new Set(['__proto__', 'constructor', 'prototype']);

/** Shared JSON-data bounds for complete documents and isolated property inputs. */
export function cleanDesignData(value, depth = 0, strict = false) {
  if (depth > 100) throw new TypeError('Design nesting limit');
  if (strict && typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Design values must contain only finite numbers');
  if (Array.isArray(value)) {
    if (value.length > 5000) throw new TypeError('Design collection limit');
    if (strict) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Design arrays cannot contain empty slots');
        cleanDesignData(value[index], depth + 1, true);
      }
    } else value.forEach(item => cleanDesignData(item, depth + 1));
  } else if (value !== null && typeof value === 'object') {
    if (strict && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Design values must use plain JSON objects');
    for (const key of Object.keys(value)) {
      if (dangerous.has(key)) throw new TypeError('Unsafe object key');
      if (strict) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Design values cannot contain mutable accessors');
      }
      cleanDesignData(value[key], depth + 1, strict);
    }
  } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
    throw new TypeError('Design must contain only JSON data');
  }
}

/** History owns detached immutable data; the current document and public snapshots remain mutable. */
export function immutableDesignData(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) immutableDesignData(item);
    Object.freeze(value);
  }
  return value;
}
