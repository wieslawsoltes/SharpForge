import {frameworkType, MEDIA} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';

/** Exports framework values without losing the declared primitive type carried by a managed box. */
export function exportPlatformValue(platform, value, depth = 0) {
  if (depth > 16) throw new ManagedFault('ExecutionLimitException', 'Framework value nesting limit');
  if (!isReference(value)) return platform.native(value);
  const record = platform.heap.get(value);
  if (record.kind === 'string') return record.data;
  if (record.kind === 'box') {
    const contents = exportPlatformValue(platform, record.data[0], depth + 1);
    return record.type === 'System.Boolean' ? Boolean(contents) : contents;
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
