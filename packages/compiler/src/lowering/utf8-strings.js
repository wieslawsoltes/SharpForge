/** UTF-8 literal data (SF-A02-T77): encode each distinct text once, including its out-of-span NUL terminator. */
import { CilError } from '@sharpforge/cil';
import { walk } from '../bound/semantic-walker.js';

// The PE writer has the same limit; check before allocating literal storage, including the trailing zero.
const MAX_DATA_BYTES = 128 * 1024 * 1024;

/** UTF-8 length of valid UTF-16 source text, bounded before allocating its data. Invalid source is rejected by the lexer. */
function encodedLength(text) {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) length++;
    else if (unit < 0x800) length += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      length += 4;
      index++;
    } else length += 3;
    if (length >= MAX_DATA_BYTES) throw new CilError('UTF-8 literal data exceeds the PE output size limit');
  }
  return length;
}

/**
 * Collect bound UTF-8 literals in source traversal order. The result maps text to {bytes, length, syntax, uri};
 * length excludes the appended zero. A seen-node set also covers bodies shared by multiple bound roots.
 * Time is O(bound nodes + unique UTF-16 text + encoded bytes); storage is O(bound nodes + unique encoded bytes).
 */
export function lowerUtf8Literals(analysis) {
  const literals = new Map();
  const seen = new Set();
  const encoder = new TextEncoder();
  const roots = [];
  let totalBytes = 0;
  for (const [key, body] of analysis.bound) {
    const owner = key?.ctor ?? key;
    const uri = owner?.uri ?? owner?.source?.uri ?? owner?.locations?.[0]?.uri ?? body?.binder?.c?.uri ?? null;
    roots.push({ body, uri });
    if (key?.initializerCall) roots.push({ body: key.initializerCall, uri });
  }
  for (let index = 0; index < roots.length; index++) {
    const { body, uri } = roots[index];
    walk(body, node => {
      if (seen.has(node)) return false;
      seen.add(node);
      // A local function's body lives on its method symbol, which the ordinary bound walker intentionally skips.
      if (node.kind === 'LocalFunction' && node.method?.body) roots.push({ body: node.method.body, uri });
      if (node.kind !== 'Utf8Literal' || literals.has(node.text)) return true;
      const length = encodedLength(node.text);
      totalBytes += length + 1;
      if (totalBytes > MAX_DATA_BYTES) throw new CilError('UTF-8 literal data exceeds the PE output size limit');
      const bytes = new Uint8Array(length + 1);
      encoder.encodeInto(node.text, bytes);
      literals.set(node.text, { bytes, length, syntax: node.syntax, uri });
      return false;
    });
  }
  return literals;
}
