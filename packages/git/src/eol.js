import { GitError } from './errors.js';

/** Git-style binary detection based on a NUL in the initial 8 KiB. */
export function isBinary(data) {
  return data.subarray(0, 8000).includes(0);
}

function equal(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toLf(data) {
  let removed = 0;
  for (let index = 0; index + 1 < data.length; index++) if (data[index] === 13 && data[index + 1] === 10) removed++;
  if (!removed) return data.slice();
  const result = new Uint8Array(data.length - removed);
  let position = 0;
  for (let index = 0; index < data.length; index++) {
    if (data[index] === 13 && data[index + 1] === 10) continue;
    result[position++] = data[index];
  }
  return result;
}

function toCrlf(data) {
  let added = 0;
  for (let index = 0; index < data.length; index++) if (data[index] === 10 && data[index - 1] !== 13) added++;
  const result = new Uint8Array(data.length + added);
  let position = 0;
  for (let index = 0; index < data.length; index++) {
    if (data[index] === 10 && data[index - 1] !== 13) result[position++] = 13;
    result[position++] = data[index];
  }
  return result;
}

function settings(data, options) {
  const { attributes = {}, autocrlf = false, nativeEol = 'lf' } = options;
  const auto = autocrlf === true || autocrlf === 'true' || autocrlf === 'input';
  const text = attributes.text === true || attributes.eol !== undefined || attributes.text === 'auto' || auto;
  const active = attributes.text !== false && text && (attributes.text === true || !isBinary(data));
  const eol = attributes.eol ?? ((autocrlf === true || autocrlf === 'true') ? 'crlf' : nativeEol);
  return { active, eol };
}

/** Convert worktree bytes into repository bytes and enforce safecrlf round-trip policy. */
export function cleanEol(data, options = {}) {
  const { active, eol } = settings(data, options);
  if (!active) return data.slice();
  const result = toLf(data);
  if (options.safecrlf === true || options.safecrlf === 'true' || options.safecrlf === 'warn') {
    const checkout = eol === 'crlf' ? toCrlf(result) : result;
    if (!equal(checkout, data)) {
      if (options.safecrlf === 'warn') options.notice?.({ code: 'GitEolLoss', message: 'Line endings change on checkout' });
      else throw new GitError('Conflict', 'Line-ending conversion is not reversible under core.safecrlf');
    }
  }
  return result;
}

/** Convert repository bytes to the explicitly selected worktree EOL convention. */
export function smudgeEol(data, options = {}) {
  const { active, eol } = settings(data, options);
  return active && eol === 'crlf' ? toCrlf(data) : data.slice();
}
