import { fail } from './errors.js';

export const referenceStart = (text, offset) => '$@%'.includes(text[offset] ?? ' ') && text[offset + 1] === '(';

/** Scan a balanced expression without interpreting its arguments or expanding quoted data. */
export function scanReference(text, start, { maxDepth = 64 } = {}) {
  if (maxDepth < 1) fail('Expression nesting limit exceeded.', 'MSB4184', { start });
  if (!referenceStart(text, start)) fail('Expected a property, item or metadata expression.', 'MSB4184', { start });
  let depth = 1;
  let quote = '';
  for (let offset = start + 2; offset < text.length; offset++) {
    const char = text[offset];
    if (quote) {
      if (referenceStart(text, offset)) {
        const nested = scanReference(text, offset, { maxDepth: maxDepth - 1 });
        offset = nested.end - 1;
      } else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') {
      if (++depth > maxDepth) fail('Expression nesting limit exceeded.', 'MSB4184', { start });
    } else if (char === ')' && --depth === 0) {
      return { kind: text[start], body: text.slice(start + 2, offset), start, end: offset + 1 };
    }
  }
  fail('Unterminated MSBuild expression.', 'MSB4184', { start, length: text.length - start });
}

/** Split arguments only at the outermost comma, preserving escaped separators. */
export function splitArguments(text, separator = ',') {
  if (!text.trim()) return [];
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let offset = 0; offset < text.length; offset++) {
    const char = text[offset];
    if (referenceStart(text, offset)) {
      offset = scanReference(text, offset).end - 1;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && text.startsWith(separator, offset)) {
      parts.push(text.slice(start, offset).trim());
      start = offset + separator.length;
      offset += separator.length - 1;
    }
    if (depth < 0) fail('Unbalanced expression argument.');
  }
  if (depth || quote) fail('Unterminated expression argument.');
  parts.push(text.slice(start).trim());
  return parts;
}

export function unquote(text) {
  if (['"', "'", '`'].includes(text[0]) && text.at(-1) === text[0]) return text.slice(1, -1);
  return text;
}

/** Read a method call or property/indexer in an instance member chain. */
export function scanMember(text, start = 0) {
  let offset = start;
  if (text[offset] === '.') offset++;
  const name = /^[A-Za-z_][\w]*/.exec(text.slice(offset))?.[0];
  if (text[offset] === '[') {
    const end = text.indexOf(']', offset + 1);
    if (end < 0) fail('Unterminated property-function indexer.');
    return { name: 'get_Item', arguments: [text.slice(offset + 1, end)], end: end + 1 };
  }
  if (!name) fail(`Invalid member expression '${text.slice(offset)}'.`);
  offset += name.length;
  if (text[offset] !== '(') return { name, arguments: null, end: offset };
  const call = scanReference('$' + text.slice(offset), 0);
  return { name, arguments: splitArguments(call.body), end: offset + call.end - 1 };
}
