/** Small lexical extractor, not a C# parser. Rejects interpolation and nonliteral expressions. */
export function tokens(text) {
  const out = [];
  const expression =
    /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|@"(?:[^"]|"")*"|"{3,}[\s\S]*?"{3,}|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z_0-9]*|\d+|\S/g;
  for (const match of text.matchAll(expression)) {
    if (match[0].startsWith('//') || match[0].startsWith('/*')) continue;
    out.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  const stack = [];
  for (let index = 0; index < out.length; index++) {
    const value = out[index].text;
    if ('({['.includes(value) && value.length === 1) stack.push(index);
    if (')}]'.includes(value) && value.length === 1) {
      const opening = stack.pop();
      if (
        opening === undefined ||
        '({['[')}]'.indexOf(value)] !== out[opening].text
      )
        throw Error('Unbalanced extraction input');
      out[opening].close = index;
      out[index].open = opening;
    }
  }
  if (stack.length) throw Error('Unbalanced extraction input');
  return out;
}
export function stringValue(raw) {
  if (raw.startsWith('@"')) return raw.slice(2, -1).replaceAll('""', '"');
  const quotes = /^"{3,}/.exec(raw)?.[0];
  if (quotes) {
    let value = raw.slice(quotes.length, -quotes.length);
    if (!/^\r?\n/.test(value)) return value;
    const lines = value.replace(/^\r?\n/, '').split(/\r?\n/);
    const indent = lines.pop();
    if (!/^\s*$/.test(indent))
      throw Error('Invalid raw string closing indentation');
    value = lines
      .map((line) => {
        if (!line.trim()) return '';
        if (!line.startsWith(indent))
          throw Error('Invalid raw string indentation');
        return line.slice(indent.length);
      })
      .join(raw.includes('\r\n') ? '\r\n' : '\n');
    return value;
  }
  if (!raw.startsWith('"')) throw Error('Not a constant string');
  return raw
    .slice(1, -1)
    .replace(
      /\\(?:u[\da-fA-F]{4}|U[\da-fA-F]{8}|x[\da-fA-F]{1,4}|.)/g,
      (escape) => {
        const code = escape.slice(1);
        if (/^[uUx]/.test(code))
          return String.fromCodePoint(parseInt(code.slice(1), 16));
        const values = {
          0: '\0',
          a: '\x07',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
          v: '\v',
          '\\': '\\',
          '"': '"',
          "'": "'",
        };
        if (!(code in values)) throw Error('Unknown C# string escape');
        return values[code];
      },
    );
}
export function constant(items, start, end, before = start, depth = 0) {
  if (depth > 5) throw Error('Constant reference depth exceeded');
  if (start === end - 1 && /^[A-Za-z_]\w*$/.test(items[start].text)) {
    const name = items[start].text;
    for (let index = before - 1; index >= 0; index--) {
      if (items[index].text !== name || items[index + 1]?.text !== '=')
        continue;
      const stop = items.findIndex(
        (token, offset) => offset > index && token.text === ';',
      );
      return constant(items, index + 2, stop, index, depth + 1);
    }
    throw Error('Unresolved source variable: ' + name);
  }
  let value = '';
  for (let index = start; index < end; index += 2) {
    if (index > start && items[index - 1].text !== '+')
      throw Error('Source expression is not literal concatenation');
    value += stringValue(items[index].text);
  }
  if ((end - start) % 2 !== 1)
    throw Error('Source expression is not a constant');
  return value;
}
export function methods(text) {
  const all = tokens(text),
    result = [];
  for (let index = 0; index < all.length; index++) {
    if (all[index].text !== 'public') continue;
    let opening = index + 1;
    while (
      opening < index + 12 &&
      all[opening] &&
      !['(', ';', '{', '='].includes(all[opening].text)
    )
      opening++;
    if (all[opening]?.text !== '(') continue;
    const close = all[opening].close;
    if (all[close + 1]?.text !== '{') continue;
    const end = all[close + 1].close;
    if (end === undefined) continue;
    result.push({
      name: all[opening - 1].text,
      start: all[index].start,
      end: all[end].end,
      tokens: all.slice(close + 2, end).map((token) => ({
        ...token,
        close: token.close === undefined ? undefined : token.close - close - 2,
      })),
    });
    index = end;
  }
  return result;
}
