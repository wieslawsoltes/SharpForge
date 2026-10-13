import {frameworkType} from '@sharpforge/framework';

function record(value, keys) {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== keys.length ||
      keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value') ||
        descriptors[key].enumerable !== true)) return null;
  return descriptors;
}

/** A source field load carries identity, not a weak literal or a language constant value. */
export function verifyReadonlyFieldConstant(value) {
  const outer = record(value, ['readonlyField']);
  const inner = outer && record(outer.readonlyField.value, ['owner', 'name']);
  if (!inner) return false;
  const owner = inner.owner.value;
  const name = inner.name.value;
  if (typeof owner !== 'string' || !owner || owner.length > 1024 || owner.includes('\0') ||
      typeof name !== 'string' || !name || name.length > 512 || name.includes('\0')) return false;
  const entry = frameworkType(owner);
  const field = entry?.name === owner && entry.fields && Object.hasOwn(entry.fields, name) ? entry.fields[name] : null;
  return field?.type === 'string' && field.isStatic === true && field.readOnly === true;
}
