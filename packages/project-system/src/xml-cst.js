/** A bounded, lossless XML tree. Offsets are UTF-16 offsets into the original source, including a BOM. */
export function parseXmlCst(source, options = {}) {
  const {maxLength = 4_000_000, maxNodes = 100_000, maxDepth = 128, signal} = options;
  if (typeof source !== 'string' || source.length > maxLength) throw xmlError('XML text limit exceeded', 0);
  const document = {kind: 'document', source, start: 0, end: source.length, children: [], root: null};
  const stack = [document];
  let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let count = 0;
  const fail = message => { throw xmlError(message, position); };
  const spaces = () => { while (/[\x20\t\r\n]/.test(source[position] ?? '')) position++; };
  const name = () => {
    const match = /^[\p{L}_:][\p{L}\p{N}_.:\-\u00b7]*/u.exec(source.slice(position));
    if (!match) fail('Expected XML name');
    position += match[0].length;
    return match[0];
  };
  const append = node => {
    if (++count > maxNodes) fail('XML node limit exceeded');
    stack.at(-1).children.push(node);
  };
  while (position < source.length) {
    signal?.throwIfAborted();
    const start = position;
    if (source[position] !== '<') {
      const found = source.indexOf('<', position);
      position = found < 0 ? source.length : found;
      const raw = source.slice(start, position);
      if (raw.includes(']]>')) fail('CDATA terminator outside CDATA');
      append({kind: 'text', start, end: position, value: decodeXmlText(raw, start)});
      continue;
    }
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      if (end < 0 || source.slice(position + 4, end).includes('--')) fail('Invalid XML comment');
      position = end + 3;
      append({kind: 'comment', start, end: position, value: source.slice(start + 4, end)});
      continue;
    }
    if (source.startsWith('<![CDATA[', position)) {
      if (stack.length === 1) fail('CDATA requires an element');
      const end = source.indexOf(']]>', position + 9);
      if (end < 0) fail('Unterminated CDATA');
      position = end + 3;
      append({kind: 'cdata', start, end: position, value: source.slice(start + 9, end)});
      continue;
    }
    if (source.startsWith('<?', position)) {
      position += 2;
      const target = name();
      const end = source.indexOf('?>', position);
      if (end < 0) fail('Unterminated processing instruction');
      if (target.toLowerCase() === 'xml' && (start > (source.charCodeAt(0) === 0xfeff ? 1 : 0))) {
        fail('XML declaration must be first');
      }
      position = end + 2;
      append({kind: 'processingInstruction', name: target, start, end: position});
      continue;
    }
    if (source.startsWith('<!', position)) fail('DTD and entity declarations are not permitted');
    if (source.startsWith('</', position)) {
      position += 2;
      const closing = name();
      spaces();
      if (source[position++] !== '>') fail('Expected closing >');
      if (stack.length === 1 || stack.at(-1).name !== closing) fail('Mismatched XML closing tag');
      const node = stack.pop();
      node.closeStart = start;
      node.end = position;
      continue;
    }
    position++;
    const node = {kind: 'element', name: name(), attributes: [], children: [], start, end: 0,
      openEnd: 0, closeStart: 0, selfClosing: false};
    const names = new Set();
    for (;;) {
      const before = position;
      spaces();
      if (source.startsWith('/>', position)) {
        node.selfClosing = true;
        node.closeStart = position;
        position += 2;
        break;
      }
      if (source[position] === '>') { position++; break; }
      if (position === before) fail('Expected attribute separator');
      const attributeStart = position;
      const attributeName = name();
      if (names.has(attributeName)) fail('Duplicate XML attribute');
      names.add(attributeName);
      spaces();
      if (source[position++] !== '=') fail('Expected attribute =');
      spaces();
      const quote = source[position++];
      if (quote !== '"' && quote !== "'") fail('Expected quoted XML attribute');
      const valueStart = position;
      const valueEnd = source.indexOf(quote, position);
      if (valueEnd < 0) fail('Unterminated XML attribute');
      const raw = source.slice(position, valueEnd);
      if (raw.includes('<')) fail('Invalid < in XML attribute');
      position = valueEnd + 1;
      node.attributes.push({name: attributeName, value: decodeXmlText(raw, valueStart), quote,
        start: attributeStart, end: position, valueStart, valueEnd, leadingStart: before});
    }
    node.openEnd = position;
    if (node.selfClosing) node.end = position;
    append(node);
    if (!node.selfClosing) {
      if (stack.length >= maxDepth) fail('XML nesting limit exceeded');
      stack.push(node);
    }
  }
  const roots = document.children.filter(node => node.kind === 'element');
  if (stack.length !== 1 || roots.length !== 1 || document.children.some(node => node.kind === 'text' && node.value.trim())) {
    fail('XML must contain exactly one complete root');
  }
  document.root = roots[0];
  return document;
}

function xmlError(message, offset) {
  return Object.assign(new Error(`${message} at XML offset ${offset}`), {code: 'SFP2100', offset});
}

/** Decode only XML's predefined and numeric entities; external entity resolution is never performed. */
export function decodeXmlText(value, offset = 0) {
  const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
  return value.replace(/&([^;]*);|&/g, (whole, entity, index) => {
    if (Object.hasOwn(entities, entity)) return entities[entity];
    if (/^#(?:x[0-9a-f]+|\d+)$/i.test(entity ?? '')) {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff) return String.fromCodePoint(code);
    }
    throw xmlError('Unsupported or invalid XML entity', offset + index);
  });
}

/** Serialize the immutable concrete syntax tree without normalization of any source character. */
export function serializeXmlCst(document) {
  if (document?.kind !== 'document' || typeof document.source !== 'string') throw xmlError('Expected XML CST document', 0);
  return document.source;
}

/** Apply non-overlapping UTF-16 edits atomically, rejecting stale spans and malformed resulting XML. */
export function applyXmlEdits(input, edits, options = {}) {
  const source = typeof input === 'string' ? input : serializeXmlCst(input);
  if (!Array.isArray(edits) || edits.length > 100_000) throw xmlError('Invalid XML edit list', 0);
  const ordered = edits.map(edit => ({...edit})).sort((left, right) => left.start - right.start || left.end - right.end);
  let previousEnd = 0;
  const parts = [];
  for (const edit of ordered) {
    options.signal?.throwIfAborted();
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < previousEnd ||
      edit.end < edit.start || edit.end > source.length || typeof edit.text !== 'string') throw xmlError('Overlapping or invalid XML edit', edit.start);
    if (edit.expected !== undefined && source.slice(edit.start, edit.end) !== edit.expected) throw xmlError('Stale XML edit', edit.start);
    parts.push(source.slice(previousEnd, edit.start), edit.text);
    previousEnd = edit.end;
  }
  parts.push(source.slice(previousEnd));
  const text = parts.join('');
  parseXmlCst(text, options);
  return text;
}
