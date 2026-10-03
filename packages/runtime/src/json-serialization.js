import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';
import {JSON_DEPTH_LIMIT, JSON_NODE_LIMIT} from './json-limits.js';
import {escapeJsonStrings} from './json-escaping.js';

/** Serialize the existing primitive, array and closed-collection profile with bounded default string escaping. */
export function serializeJson(platform, input) {
  const seen = new Set();
  let nodes = 0;
  const visit = (value, depth) => {
    if (depth > JSON_DEPTH_LIMIT || ++nodes > JSON_NODE_LIMIT) {
      throw new ManagedFault('JsonException', 'Serialization depth or node limit exceeded');
    }
    value = platform.native(value);
    if (!isReference(value)) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new ManagedFault('JsonException', 'Nonfinite numbers are not supported');
      }
      return value;
    }
    const identity = value.h + ':' + value.g;
    if (seen.has(identity)) throw new ManagedFault('JsonException', 'Object cycle');
    seen.add(identity);
    try {
      const record = platform.heap.get(value);
      const type = frameworkType(record.type);
      if (record.kind === 'box') return visit(record.data[0], depth + 1);
      if (record.kind === 'array') return record.data.map(item => visit(item, depth + 1));
      if (type?.kind === 'bcl' && ['List', 'Queue', 'Stack', 'HashSet'].includes(type.family)) {
        const storage = platform.get(value, '$data');
        const data = storage ? platform.heap.get(storage).data : [];
        const count = platform.get(value, '$count');
        const head = platform.get(value, '$head', 0);
        return Array.from({length: count}, (_, index) => {
          const position = type.family === 'Queue' ? (head + index) % data.length
            : type.family === 'Stack' ? count - 1 - index : index;
          return visit(data[position], depth + 1);
        });
      }
      if (type?.family === 'Dictionary' && type.key === 'string') {
        const result = Object.create(null);
        const storage = platform.get(value, '$data');
        const data = storage ? platform.heap.get(storage).data : [];
        for (let index = 0; index < platform.get(value, '$count'); index++) {
          result[platform.native(data[index * 2])] = visit(data[index * 2 + 1], depth + 1);
        }
        return result;
      }
      throw new ManagedFault('NotSupportedException',
        'JSON serialization supports primitives, arrays and the registered collections, not arbitrary object reflection');
    } finally {
      seen.delete(identity);
    }
  };
  return escapeJsonStrings(JSON.stringify(visit(input, 0)));
}
