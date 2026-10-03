/** UTF-8 string literal suffix (C# 11): `"text"u8` on regular, verbatim and raw strings. */
export function utf8SuffixLength(text, i) {
  return (text[i] === 'u' || text[i] === 'U') && text[i + 1] === '8' ? 2 : 0;
}
/** Encodes UTF-16 text to UTF-8. Returns { bytes, error } where error is set for unpaired surrogates (CS9026). */
export function encodeUtf8(value) {
  const bytes = [];
  let error = null;
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff)
      code = 0x10000 + ((code - 0xd800) << 10) + (value.charCodeAt(++i) - 0xdc00);
    else if (code >= 0xd800 && code <= 0xdfff) {
      error ??= {
        code: 'CS9026',
        message:
          'The input string cannot be converted into the equivalent UTF-8 byte representation. Unable to translate Unicode character \\u' +
          code.toString(16).toUpperCase() +
          ' at index ' +
          i +
          ' to specified code page.'
      };
      code = 0xfffd;
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return { bytes: Uint8Array.from(bytes), error };
}
