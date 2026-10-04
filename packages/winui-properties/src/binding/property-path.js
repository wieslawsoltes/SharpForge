/** A positional syntax failure consumed by the binding diagnostics channel. */
export class BindingPathError extends SyntaxError {
  constructor(message, position) {
    super(message);
    this.position = position;
  }
}

/** Parse property/indexer/attached segments once; execution never reparses a path. */
export function parsePropertyPath(value, {maxLength = 4096, maxSegments = 128} = {}) {
  const text = typeof value === 'string' ? value : value?.Path ?? value?.path ?? '';
  if (typeof text !== 'string' || text.length > maxLength) throw new BindingPathError('Property path length exceeded', 0);
  const steps = [];
  let position = 0;
  let requireSegment = true;
  const fail = message => { throw new BindingPathError(message, position); };
  const whitespace = () => { while (position < text.length && /\s/.test(text[position])) position++; };
  whitespace();
  if (position === text.length || text.trim() === '.') return Object.freeze([]);
  while (position < text.length) {
    whitespace();
    if (steps.length >= maxSegments) fail('Property path segment limit exceeded');
    const start = position;
    if (text[position] === '[') {
      const parsed = readIndex(text, position);
      position = parsed.end;
      steps.push(Object.freeze({kind: 'index', key: parsed.key, position: start}));
    } else if (text[position] === '(') {
      if (!requireSegment) fail('A property separator is required');
      const close = text.indexOf(')', position + 1);
      if (close < 0) fail('Unterminated attached property');
      const member = text.slice(position + 1, close).trim();
      const dot = member.lastIndexOf('.');
      if (dot < 1 || dot === member.length - 1 || /[()[\]\s]/.test(member)) fail('Invalid attached property');
      steps.push(Object.freeze({kind: 'attached', owner: member.slice(0, dot), name: member.slice(dot + 1), position: start}));
      position = close + 1;
    } else {
      if (!requireSegment) fail('A property separator is required');
      const match = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(text.slice(position));
      if (!match) fail('Expected a property name');
      position += match[0].length;
      steps.push(Object.freeze({kind: 'property', name: match[0], position: start}));
    }
    requireSegment = false;
    whitespace();
    if (text[position] === '.') {
      position++;
      requireSegment = true;
      whitespace();
      if (position === text.length) fail('Property path cannot end with a separator');
    } else if (position < text.length && text[position] !== '[') fail('Unexpected property path character');
  }
  return Object.freeze(steps);
}

function readIndex(text, start) {
  let position = start + 1;
  while (/\s/.test(text[position] ?? '') && position < text.length) position++;
  let key = '';
  const quote = text[position] === '"' || text[position] === "'" ? text[position++] : null;
  if (quote) {
    let closed = false;
    while (position < text.length) {
      let character = text[position++];
      if (character === quote) { closed = true; break; }
      if (character === '\\') {
        if (position === text.length) throw new BindingPathError('Incomplete index escape', position);
        character = text[position++];
        const escapes = {n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'"};
        if (!Object.hasOwn(escapes, character)) throw new BindingPathError('Unknown index escape', position - 1);
        character = escapes[character];
      }
      key += character;
    }
    if (!closed) throw new BindingPathError('Unterminated quoted index', position);
    while (/\s/.test(text[position] ?? '') && position < text.length) position++;
  } else {
    const close = text.indexOf(']', position);
    if (close < 0) throw new BindingPathError('Unterminated index', position);
    key = text.slice(position, close).trim();
    position = close;
    if (/^[+-]?\d+$/.test(key)) {
      key = Number(key);
      if (!Number.isSafeInteger(key)) throw new BindingPathError('Indexer integer is outside the safe range', start);
    }
  }
  if (text[position] !== ']' || key === '') throw new BindingPathError('Invalid index', position);
  return {key, end: position + 1};
}

export class PropertyPath {
  constructor(path = '') {
    if (typeof path !== 'string') throw new TypeError('PropertyPath requires a string');
    this.Path = path;
    this.reconstructible = true;
    Object.freeze(this);
  }
}
