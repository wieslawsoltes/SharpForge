/** Preflight listener snapshots before modifying an observable owner's state. */
export function restoreListeners(entries, nextToken, limit, used = new Set()) {
  if (!Array.isArray(entries) || entries.length > limit || !Number.isSafeInteger(nextToken) || nextToken < 1) {
    throw new TypeError('Invalid observable listener snapshot');
  }
  const result = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 1
      || entry[0] >= nextToken || used.has(entry[0]) || typeof entry[1] !== 'function') {
      throw new TypeError('Invalid observable listener snapshot');
    }
    used.add(entry[0]);
    result.set(entry[0], entry[1]);
  }
  return result;
}

export function listenerToken(owner, listener, limit) {
  if (typeof listener !== 'function') throw new TypeError('An observable listener must be a function');
  if (owner.subscriberCount >= limit || owner.nextToken >= Number.MAX_SAFE_INTEGER) throw new RangeError('Observable listener limit');
  return owner.nextToken++;
}

export function positiveLimit(value, name, {zero = false} = {}) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 1000000) throw new RangeError('Invalid ' + name + ' budget');
  return value;
}

/** Managed roots are explicit metadata; closures themselves never keep managed owners alive. */
export function* retainedListenerValues(listeners, limit = 1000000) {
  let count = 0;
  for (const listener of listeners) {
    if (typeof listener?.retainedValues !== 'function') continue;
    for (const value of listener.retainedValues()) {
      if (++count > limit) throw new RangeError('Observable retained reference limit');
      yield value;
    }
  }
}

export function inheritListenerRoots(wrapper, listener) {
  if (typeof listener?.retainedValues === 'function') wrapper.retainedValues = () => listener.retainedValues();
  return wrapper;
}
