import {MAX, bclScalar, fail, string, text} from '../host.js';
import {insertionIndex} from './string-builder-edit.js';

const owner = 'System.Text.StringBuilder';
const insertedTypes = Object.freeze([
  'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal', 'object'
]);

/** Append scalar and Object insertion signatures after repeated string insertion 524339. */
export function registerStringBuilderValueInsertExtensions({member}) {
  for (const type of insertedTypes) member(owner, 'Insert', ['int', type], owner);
}

/** Commit already-validated insertion text; empty input is a no-op and host limits precede builder reads. */
export function insertValidatedBuilderText(platform, reference, index, value, insertText) {
  if (!value) return reference;
  if (value.length > MAX - platform.get(reference, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  return insertText(platform, reference, index, value);
}

/** Preserve string insertion's native index checks, then return unchanged for null or empty text. */
export function insertBuilderString(platform, reference, values, insertText) {
  const index = insertionIndex(platform, reference, bclScalar(platform, values[0]));
  const value = string(platform, values[1], true);
  return insertValidatedBuilderText(platform, reference, index, value, insertText);
}

/** Format numeric values using the selected CLR width and preserve the existing bounded storage commit. */
export function insertBuilderNumeric(platform, descriptor, reference, values, insertText) {
  const value = text(platform, values[1], descriptor.parameters[1]);
  const index = insertionIndex(platform, reference, bclScalar(platform, values[0]));
  return insertValidatedBuilderText(platform, reference, index, value, insertText);
}
