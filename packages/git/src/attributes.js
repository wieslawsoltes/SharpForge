import { compileWildmatch } from './ignore.js';
import { GitError, checkLimit } from './errors.js';

function attributeTokens(line) {
  const tokens = [];
  let position = 0;
  while (position < line.length) {
    while (/\s/u.test(line[position] ?? '') && position < line.length) position++;
    if (position >= line.length) break;
    let value = '';
    if (line[position] === '"') {
      position++;
      while (position < line.length && line[position] !== '"') {
        const character = line[position++];
        if (character !== '\\') { value += character; continue; }
        const escaped = line[position++];
        if (/[0-7]/u.test(escaped ?? '')) {
          let octal = escaped;
          for (let count = 0; count < 2 && /[0-7]/u.test(line[position] ?? ''); count++) octal += line[position++];
          value += String.fromCharCode(Number.parseInt(octal, 8));
        } else value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[escaped] ?? escaped;
      }
      if (line[position] !== '"') throw new GitError('Corrupt', 'Unterminated quoted attribute pattern');
      position++;
    } else {
      while (position < line.length && !/\s/u.test(line[position])) value += line[position++];
    }
    tokens.push(value);
  }
  return tokens;
}

function parseAttributes(tokens, macros) {
  const attributes = {};
  for (const token of tokens) {
    if (!token) continue;
    const separator = token.indexOf('=');
    if (token.startsWith('-')) attributes[token.slice(1)] = false;
    else if (token.startsWith('!')) attributes[token.slice(1)] = undefined;
    else if (separator >= 0) attributes[token.slice(0, separator)] = token.slice(separator + 1);
    else {
      attributes[token] = true;
      if (macros.has(token)) Object.assign(attributes, macros.get(token));
    }
  }
  return attributes;
}

/** Ordered .gitattributes matcher; values preserve set/unset/unspecified/string states. */
export class AttributesMatcher {
  constructor(sources = []) {
    this.rules = [];
    this.macros = new Map([['binary', { diff: false, merge: false, text: false }]]);
    for (const source of sources) this.add(source.text, source);
  }

  add(text, { base = '', source = '.gitattributes', priority = 0 } = {}) {
    const lines = String(text).replace(/^\ufeff/u, '').split(/\r?\n/u);
    checkLimit(lines.length, 100000, 'Attribute patterns');
    for (const line of lines) {
      const tokens = attributeTokens(line.trim());
      const pattern = tokens.shift();
      if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) continue;
      const values = parseAttributes(tokens, this.macros);
      if (pattern.startsWith('[attr]') && !base) this.macros.set(pattern.slice(6), values);
      else if (!pattern.endsWith('/')) this.rules.push({ base, source, priority, values,
        anchored: pattern.includes('/'), matcher: compileWildmatch(pattern.replace(/^\//u, '')) });
    }
    this.rules.sort((left, right) => left.priority - right.priority || left.base.split('/').length - right.base.split('/').length);
    return this;
  }

  get(path) {
    const result = {};
    for (const rule of this.rules) {
      if (rule.base && !path.startsWith(`${rule.base}/`)) continue;
      const relative = rule.base ? path.slice(rule.base.length + 1) : path;
      const candidate = rule.anchored ? relative : relative.slice(relative.lastIndexOf('/') + 1);
      if (rule.matcher.test(candidate)) Object.assign(result, rule.values);
    }
    return result;
  }
}
