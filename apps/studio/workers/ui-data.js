/** Data crossing the worker boundary is bounded and cannot contain host objects, accessors or executable members. */
export function assertUIHostData(value) {
  const active = new Set();
  let nodes = 0, bytes = 0;
  const visit = (item, depth) => {
    if (++nodes > 100000 || depth > 32) throw new RangeError('UI host data nesting budget exceeded');
    if (item == null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('UI host data requires finite numbers');
      return;
    }
    if (typeof item === 'string') bytes += item.length * 2;
    else if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) bytes += item.byteLength;
    else {
      if (typeof item !== 'object' || active.has(item)) throw new TypeError('UI host data contains an unsupported value or cycle');
      if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
        throw new TypeError('UI host objects require an explicit data projection');
      }
      active.add(item);
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (Array.isArray(item) && name === 'length') continue;
        if (['__proto__', 'prototype', 'constructor'].includes(name) || descriptor.get || descriptor.set) {
          throw new TypeError('Invalid UI host data member');
        }
        visit(descriptor.value, depth + 1);
      }
      active.delete(item);
    }
    if (bytes > 64 * 1024 * 1024) throw new RangeError('UI host data byte budget exceeded');
  };
  visit(value, 0);
  return value;
}

