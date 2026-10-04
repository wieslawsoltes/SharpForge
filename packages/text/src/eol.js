export const EndOfLine = Object.freeze({ LF: '\n', CRLF: '\r\n', CR: '\r' });

/** Describe line endings without normalizing contents, including mixed endings and final-newline state. */
export function analyzeEol(text, { encoding = 'utf-8', bom = false, defaultEol = '\n' } = {}) {
  const counts = text?.eolCounts ?? { cr: 0, lf: 0, crlf: 0 };
  if (typeof text === 'string') {
    for (let offset = 0; offset < text.length; offset++) {
      if (text.charCodeAt(offset) === 13) {
        if (text.charCodeAt(offset + 1) === 10) { counts.crlf++; offset++; }
        else counts.cr++;
      } else if (text.charCodeAt(offset) === 10) counts.lf++;
    }
  } else if (!text?.eolCounts) throw new TypeError('Expected a string or text snapshot');
  const maximum = Math.max(counts.cr, counts.lf, counts.crlf);
  const dominantEol = maximum === 0 ? defaultEol : counts.crlf === maximum ? '\r\n' : counts.lf === maximum ? '\n' : '\r';
  const last = typeof text === 'string' ? text.charCodeAt(text.length - 1) : text.charCodeAt(text.length - 1);
  return Object.freeze({
    dominantEol, eol: dominantEol, mixedEol: Object.values(counts).filter(Boolean).length > 1,
    counts: Object.freeze(counts), finalNewline: last === 13 || last === 10, encoding, bom
  });
}

/** Normalize terminators only; other UTF-16 code units are preserved exactly. */
export function normalizeEol(text, eol = '\n') {
  if (!Object.values(EndOfLine).includes(eol)) throw new RangeError('Unsupported line ending');
  if (typeof text !== 'string') throw new TypeError('Expected text');
  return text.replace(/\r\n|\r|\n/g, eol);
}

/** Build terminator-only edits so conversion remains one operation and preserves interior text selections. */
export function eolEdits(source, eol = '\n') {
  if (!Object.values(EndOfLine).includes(eol)) throw new RangeError('Unsupported line ending');
  const edits = [];
  for (let line = 0; line + 1 < source.lineCount; line++) {
    const start = source.lineEnd(line);
    const end = source.lineStart(line + 1);
    if (source.getText(start, end) !== eol) edits.push({ start, end, text: eol });
  }
  return edits;
}

/** Decode explicit UTF encodings; byte-order marks are tracked separately from document text. */
export function decodeText(bytes, { encoding = 'utf-8', fatal = true } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  let skip = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { encoding = 'utf-8'; skip = 3; }
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; skip = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; skip = 2; }
  const text = new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(bytes.subarray(skip));
  return { text, encoding, bom: skip !== 0, ...analyzeEol(text, { encoding, bom: skip !== 0 }) };
}

/** Encode UTF-8/UTF-16 with an explicit BOM policy. Reject unsupported encodings rather than corrupting text. */
export function encodeText(text, { encoding = 'utf-8', bom = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  encoding = encoding.toLowerCase();
  if (encoding === 'utf-8' || encoding === 'utf8') {
    const content = new TextEncoder().encode(text);
    if (!bom) return content;
    const output = new Uint8Array(content.length + 3);
    output.set([0xef, 0xbb, 0xbf]);
    output.set(content, 3);
    return output;
  }
  if (!['utf-16le', 'utf-16be'].includes(encoding)) throw new RangeError(`Unsupported output encoding: ${encoding}`);
  const output = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
  const view = new DataView(output.buffer);
  const littleEndian = encoding === 'utf-16le';
  if (bom) view.setUint16(0, 0xfeff, littleEndian);
  const prefix = bom ? 2 : 0;
  for (let index = 0; index < text.length; index++) view.setUint16(prefix + index * 2, text.charCodeAt(index), littleEndian);
  return output;
}
