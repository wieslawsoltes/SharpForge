/** Reject unpaired UTF-16 units before an encoder can replace or emit text that the strict reader cannot restore. */
export function validateSourceEncoding(text, {path = 'Program.cs', offset = 0, bom = false} = {}) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0 || code === 0xfeff && index + offset === 0 && !bom) {
      const message = code === 0 ? 'a NUL character that cannot be reopened as source'
        : 'a leading U+FEFF character without a separate BOM marker';
      throw invalidSource(path, index + offset, message);
    }
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = text.charCodeAt(index + 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      index++;
      continue;
    }
    throw invalidSource(path, offset + index, 'an unpaired surrogate');
  }
}

function invalidSource(path, start, reason) {
  const error = new TypeError(`Source '${path}' contains ${reason} at offset ${start}; saving would lose text.`);
  Object.assign(error, {code: 'SFPROJECT_SOURCE_ENCODING_LOSS', severity: 'error', path, start, length: 1});
  return error;
}
