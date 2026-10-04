import {bclScalar, string} from '../host.js';
import {insertionIndex} from './string-builder-edit.js';
import {insertValidatedBuilderText} from './string-builder-insert-values.js';

/** Invoke virtual Object.ToString once before validating the live insertion position; null objects bypass the index. */
export function insertBuilderObject(platform, reference, values, insertText) {
  const value = values[1];
  if (value === null) return reference;
  const converted = platform.bclHost.invokeObjectToString?.(platform, value);
  if (converted?.canceled) return reference;
  if (converted?.handled) {
    return platform.heap.withRoots([converted.value], () => {
      const index = insertionIndex(platform, reference, bclScalar(platform, values[0]));
      const text = string(platform, converted.value, true);
      return insertValidatedBuilderText(platform, reference, index, text, insertText);
    });
  }
  // Preserve the original box: unwrapping here loses Char, UInt32, Single and enum display semantics.
  const text = platform.vm.format(value);
  const index = insertionIndex(platform, reference, bclScalar(platform, values[0]));
  return insertValidatedBuilderText(platform, reference, index, text, insertText);
}
