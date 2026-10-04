import {snapshotFormatError as fail} from './snapshot-wire-values.js';

function stringBytes(value, limit) {
  let bytes = 2;
  if (value.length > limit - bytes) fail('SNAPSHOT_LIMIT', 'Snapshot JSON byte limit exceeded');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
      else bytes += 6;
    } else bytes += 3;
    if (bytes > limit) fail('SNAPSHOT_LIMIT', 'Snapshot JSON byte limit exceeded');
  }
  return bytes;
}

/** Validate plain JSON before stringify can invoke hooks or expand sparse/escaped input. */
export function assertSnapshotJSON(root, limits) {
  const pending = [], seen = new Set();
  let items = 0, bytes = 0;
  const charge = count => {
    bytes += count;
    if (bytes > limits.maxBytes) fail('SNAPSHOT_LIMIT', 'Snapshot JSON byte limit exceeded');
  };
  const visit = (value, depth) => {
    if (++items > limits.maxItems || depth > 128) fail('SNAPSHOT_LIMIT', 'Snapshot JSON nesting or item limit exceeded');
    if (value === null) charge(4);
    else if (typeof value === 'string') charge(stringBytes(value, limits.maxBytes - bytes));
    else if (typeof value === 'boolean') charge(value ? 4 : 5);
    else if (typeof value === 'number' && Number.isFinite(value)) charge(String(value).length);
    else if (typeof value === 'object') {
      if (seen.has(value)) fail('SNAPSHOT_JSON', 'Wire aliases must use numbered graph references');
      seen.add(value);
      const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) {
        fail('SNAPSHOT_JSON', 'Wire objects must be plain JSON records');
      }
      if (Object.getOwnPropertyDescriptor(value, 'toJSON')) fail('SNAPSHOT_JSON', 'Wire serialization hooks are not supported');
      const keys = array ? null : Object.keys(value), length = array ? value.length : keys.length;
      if (length > limits.maxItems - items) fail('SNAPSHOT_LIMIT', 'Snapshot JSON container limit exceeded');
      charge(2 + Math.max(0, length - 1));
      pending.push({value, keys, index: 0, length, depth});
    } else fail('SNAPSHOT_JSON', 'Wire values must be JSON scalars');
  };
  visit(root, 0);
  while (pending.length) {
    const current = pending.at(-1);
    if (current.index === current.length) { pending.pop(); continue; }
    const key = current.keys ? current.keys[current.index++] : String(current.index++);
    const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('SNAPSHOT_JSON', 'Wire accessors and sparse arrays are not supported');
    if (current.keys) charge(stringBytes(key, limits.maxBytes - bytes - 1) + 1);
    visit(descriptor.value, current.depth + 1);
  }
  return bytes;
}

/** The bounded walk precedes all potentially large JSON/UTF-8 allocations. */
export function snapshotJSONString(value, limits) {
  assertSnapshotJSON(value, limits);
  return JSON.stringify(value);
}

/** Count UTF-8 input without first allocating a second copy of untrusted JSON. */
export function assertSnapshotText(text, limits) {
  if (text.length > limits.maxBytes) fail('SNAPSHOT_LIMIT', 'Portable snapshot byte limit exceeded');
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index), next = text.charCodeAt(index + 1);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > limits.maxBytes) fail('SNAPSHOT_LIMIT', 'Portable snapshot byte limit exceeded');
  }
  return bytes;
}
