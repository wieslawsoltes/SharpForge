import {MAX, fail, integer} from '../host.js';

const owner = 'System.Text.StringBuilder';
const maximumCapacity = 2147483647;

/** Append character contracts at the current A07 tail without changing earlier builder IDs. */
export function registerStringBuilderCharacterExtensions({member}) {
  member(owner, 'Append', ['char'], owner);
  member(owner, 'Append', ['char', 'int'], owner);
}

/** Expand one bounded UTF-16 unit into one existing builder append, preserving zero-count no-op behavior. */
export function appendBuilderCharacter(platform, reference, values, appendText) {
  const unit = integer(platform, values[0], 0, 65535);
  const count = values.length === 1 ? 1 : values[1];
  const length = platform.get(reference, '$length', 0);
  if (!Number.isInteger(count) || count < 0 || count > maximumCapacity - length) {
    fail(platform, 'ArgumentOutOfRangeException', "Repeat count exceeds the builder capacity. (Parameter 'repeatCount')");
  }
  if (count === 0) return reference;
  if (count > MAX - length) fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  return appendText(platform, reference, String.fromCharCode(unit).repeat(count));
}
