import {MAX, fail} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Append the source-builder overload after the ordered A07 predecessor contracts. */
export function registerStringBuilderValueExtensions({member}) {
  member(owner, 'Append', [owner], owner);
}

/** Capture live source text before writes, then reuse one bounded append; null/empty sources are no-ops. */
export function appendBuilderValue(platform, destination, source, bufferText, appendText) {
  if (source === null) return destination;
  if (platform.record(source).type !== owner) {
    fail(platform, 'InvalidCastException', 'A StringBuilder source is required');
  }
  const length = platform.get(source, '$length', 0);
  if (length === 0) return destination;
  if (length > MAX - platform.get(destination, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  return appendText(platform, destination, bufferText(platform, source));
}
