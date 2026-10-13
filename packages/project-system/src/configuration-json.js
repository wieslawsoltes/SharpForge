import { EvaluationError } from './evaluation/errors.js';

/** Parse bounded JSON with comments/trailing commas and exact UTF-16 error locations. */
export function parseConfigurationJson(source, { maxLength = 1_000_000, maxDepth = 64, maxNodes = 100000,
  allowTrailingCommas = true } = {}) {
  let offset = 0;
  let nodes = 0;
  const fail = message => {
    const before = typeof source === 'string' ? source.slice(0, offset) : '';
    throw new EvaluationError(message, 'SFJSON001', {
      start: offset,
      length: 1,
      line: before.split('\n').length,
      column: offset - before.lastIndexOf('\n'),
    });
  };
  if (typeof source !== 'string' || source.length > maxLength) fail('Configuration JSON text limit exceeded.');
  if (source.charCodeAt(0) === 0xfeff) offset++;
  function trivia() {
    while (offset < source.length) {
      const char = source[offset];
      if (' \t\r\n'.includes(char)) {
        offset++;
        continue;
      }
      if (source.startsWith('//', offset)) {
        const end = source.indexOf('\n', offset + 2);
        offset = end < 0 ? source.length : end + 1;
      } else if (source.startsWith('/*', offset)) {
        const end = source.indexOf('*/', offset + 2);
        if (end < 0) fail('Unterminated configuration JSON comment.');
        offset = end + 2;
      } else break;
    }
  }
  function string() {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '"') return JSON.parse(source.slice(start, offset));
      if (char.charCodeAt(0) < 32) fail('Control character in JSON string.');
      if (char !== '\\') continue;
      const escape = source[offset++];
      if (escape === 'u') {
        if (!/^[\da-f]{4}$/i.test(source.slice(offset, offset + 4))) fail('Invalid Unicode JSON escape.');
        offset += 4;
      } else if (!escape || !'"\\/bfnrt'.includes(escape)) fail('Invalid JSON string escape.');
    }
    fail('Unterminated JSON string.');
  }
  function container(depth, object) {
    const result = object ? {} : [];
    const closing = object ? '}' : ']';
    offset++;
    trivia();
    if (source[offset] === closing) {
      offset++;
      return result;
    }
    for (;;) {
      let key;
      if (object) {
        if (source[offset] !== '"') fail('Expected a JSON object property name.');
        key = string();
        trivia();
        if (source[offset] !== ':') fail('Expected a colon after a JSON property name.');
        offset++;
      }
      const item = value(depth + 1);
      if (object) Object.defineProperty(result, key, { value: item, configurable: true, enumerable: true, writable: true });
      else result.push(item);
      trivia();
      if (source[offset] === closing) {
        offset++;
        return result;
      }
      if (source[offset] !== ',') fail(`Expected a comma or '${closing}'.`);
      offset++;
      trivia();
      if (source[offset] === closing) {
        if (!allowTrailingCommas) fail('Trailing commas are not allowed in this configuration file.');
        offset++;
        return result;
      }
    }
  }
  function value(depth) {
    trivia();
    if (depth > maxDepth) fail('Configuration JSON nesting limit exceeded.');
    if (++nodes > maxNodes) fail('Configuration JSON node limit exceeded.');
    const char = source[offset];
    if (char === '{') return container(depth, true);
    if (char === '[') return container(depth, false);
    if (char === '"') return string();
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return value;
      }
    }
    const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (numeric) {
      offset += numeric[0].length;
      return Number(numeric[0]);
    }
    fail(offset >= source.length ? 'Unexpected end of configuration JSON.' : `Unexpected '${char}' in configuration JSON.`);
  }
  const result = value(0);
  trivia();
  if (offset !== source.length) fail('Unexpected content after the JSON value.');
  return result;
}
