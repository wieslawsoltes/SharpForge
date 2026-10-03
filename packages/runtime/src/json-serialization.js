import {frameworkType} from '@sharpforge/framework';
import {dictionaryEntries, hashSetValues} from '@sharpforge/bcl-collections';
import {ManagedFault, isReference} from './heap.js';
import {JSON_DEPTH_LIMIT, JSON_NODE_LIMIT} from './json-limits.js';
import {escapeJsonStrings} from './json-escaping.js';
import {writeJsonTokens} from './json-token-writer.js';

function primitiveValue(value, type) {
  if (value === null) return null;
  if (type === 'bool' || type === 'System.Boolean') return Boolean(value);
  if (type === 'char' || type === 'System.Char') {
    return typeof value === 'string' ? value : String.fromCharCode(value);
  }
  return value;
}

/** Serialize the existing primitive, array and closed-collection profile with bounded default string escaping. */
export function serializeJson(platform, input) {
  const seen = new Set();
  let nodes = 0;
  const visit = (value, depth, declaredType) => {
    if (depth > JSON_DEPTH_LIMIT || ++nodes > JSON_NODE_LIMIT) {
      throw new ManagedFault('JsonException', 'Serialization depth or node limit exceeded');
    }
    // Preserve the box type before native conversion erases Boolean/Char identity.
    const boxed = isReference(value) && platform.heap.get(value).kind === 'box';
    if (!boxed) value = platform.native(value);
    if (!isReference(value)) {
      value = primitiveValue(value, declaredType);
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
      if (record.kind === 'box') return visit(record.data[0], depth + 1, record.methodTable.name);
      if (record.kind === 'array') return record.data.map(item => visit(item, depth + 1));
      if (type?.kind === 'bcl' && type.family === 'HashSet') {
        return Array.from(hashSetValues(platform, value), item => visit(item, depth + 1));
      }
      if (type?.kind === 'bcl' && ['List', 'Queue', 'Stack'].includes(type.family)) {
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
      if (type?.family === 'Dictionary' && (type.key === 'string' || type.key === 'int')) {
        // Maps preserve collection entry order even when property names look like array indices.
        const result = new Map();
        for (const [key, item] of dictionaryEntries(platform, value)) {
          result.set(String(platform.native(key)), visit(item, depth + 1, type.element));
        }
        return result;
      }
      throw new ManagedFault('NotSupportedException',
        'JSON serialization supports primitives, arrays and the registered collections, not arbitrary object reflection');
    } finally {
      seen.delete(identity);
    }
  };
  return escapeJsonStrings(writeJsonTokens(visit(input, 0)));
}
