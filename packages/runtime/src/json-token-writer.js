import {formatDoubleDefault} from '@sharpforge/bcl-core';
import {ManagedFault} from './heap.js';
import {JSON_TEXT_LIMIT} from './json-limits.js';

function omitted(value) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** Encode a validated native JSON tree, retaining binary64 spelling before negative zero is lost. */
export function writeJsonTokens(input) {
  if (omitted(input)) return undefined;
  const parts = [];
  let length = 0;
  const append = token => {
    length += token.length;
    if (length > JSON_TEXT_LIMIT) throw new ManagedFault('JsonException', 'Serialized JSON text limit exceeded');
    parts.push(token);
  };
  const write = value => {
    if (typeof value === 'number') {
      append(formatDoubleDefault(value));
    } else if (value === null || typeof value !== 'object') {
      append(JSON.stringify(value));
    } else if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) {
        if (index) append(',');
        if (omitted(value[index])) append('null');
        else write(value[index]);
      }
      append(']');
    } else {
      append('{');
      let separator = false;
      // Dictionary maps carry managed enumeration order through integer property names.
      const entries = value instanceof Map ? value : Object.entries(value);
      for (const [key, item] of entries) {
        if (omitted(item)) continue;
        if (separator) append(',');
        append(JSON.stringify(key));
        append(':');
        write(item);
        separator = true;
      }
      append('}');
    }
  };
  write(input);
  return parts.join('');
}
