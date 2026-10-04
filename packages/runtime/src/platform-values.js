import {frameworkType, MEDIA} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';

function boxedPrimitive(type, value) {
  if (type === 'System.Boolean') return Boolean(value);
  if (type === 'System.UInt32') return Number(value) >>> 0;
  if (type === 'System.Int64' || type === 'System.UInt64') {
    const integer = type === 'System.UInt64' ? BigInt.asUintN(64, BigInt(value)) : BigInt(value);
    const number = Number(integer);
    // Scenes retain an exact BigInt outside the JSON designer's range; inspection can then
    // reject that unsupported authoring value explicitly instead of rounding its contents.
    return Number.isSafeInteger(number) ? number : integer;
  }
  return value;
}

/** Exports framework values without losing the declared primitive type carried by a managed box. */
export function exportPlatformValue(platform, value, depth = 0) {
  if (depth > 16) throw new ManagedFault('ExecutionLimitException', 'Framework value nesting limit');
  if (!isReference(value)) return platform.native(value);
  const record = platform.heap.get(value);
  if (record.kind === 'string') return record.data;
  if (record.kind === 'box') {
    const contents = exportPlatformValue(platform, record.data[0], depth + 1);
    return boxedPrimitive(record.type, contents);
  }
  const type = frameworkType(record.type);
  if (type?.kind === 'value' || record.type === MEDIA + 'SolidColorBrush') {
    const properties = {};
    for (const [key, property] of platform.propertyEntries(value)) {
      if (!key.startsWith('$')) properties[key] = exportPlatformValue(platform, property, depth + 1);
    }
    return {valueType: record.type, ...properties};
  }
  return {$ref: `${value.h}:${value.g}`};
}
