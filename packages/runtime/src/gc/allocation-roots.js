import {isReference} from './reference.js';

/** Build multiple managed strings while each completed allocation has an explicit temporary root. */
export function makeStringProperties(platform, type, properties) {
  return platform.heap.withRoots([], () => {
    const values = {};
    for (const [key, text] of Object.entries(properties)) {
      const value = platform.heap.string(text);
      values[key] = value;
      if (isReference(value)) platform.heap.pinRoot(value);
    }
    return platform.make(type, values);
  });
}
