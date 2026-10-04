import { SearchPatternError } from './errors.js';

const CONTROL_ESCAPES = Object.freeze({ n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', '0': '\0' });

function literal(value) { return { kind: 'literal', value }; }

/** Parse regex syntax without ever invoking a native regex engine on the supplied pattern. */
export class RegexParser {
  constructor(pattern, { maxDepth = 64, maxCaptures = 128 } = {}) {
    this.pattern = pattern;
    this.offset = 0;
    this.depth = 0;
    this.groups = 0;
    this.names = Object.create(null);
    this.maxDepth = maxDepth;
    this.maxCaptures = maxCaptures;
  }
  error(message, position = this.offset) { throw new SearchPatternError(message, position); }
  parse() {
    const node = this.alternation();
    if (this.offset < this.pattern.length) this.error('Unexpected closing parenthesis');
    return { node, groups: this.groups, names: Object.freeze({ ...this.names }) };
  }
  alternation() {
    const alternatives = [this.sequence()];
    while (this.pattern[this.offset] === '|') { this.offset++; alternatives.push(this.sequence()); }
    return alternatives.length === 1 ? alternatives[0] : { kind: 'choice', alternatives };
  }
  sequence() {
    const children = [];
    while (this.offset < this.pattern.length && !['|', ')'].includes(this.pattern[this.offset])) {
      children.push(this.quantified(this.atom()));
    }
    return { kind: 'sequence', children };
  }
  atom() {
    const position = this.offset;
    const character = String.fromCodePoint(this.pattern.codePointAt(this.offset));
    this.offset += character.length;
    if (character === '(') return this.group(position);
    if (character === '[') return this.characterClass(position);
    if (character === '\\') return this.escape(false, position);
    if (character === '.') return { kind: 'any' };
    if (character === '^' || character === '$') return { kind: 'anchor', value: character };
    if (['*', '+', '?', '{', '}'].includes(character)) this.error('Quantifier has no preceding atom', position);
    return literal(character);
  }
  group(position) {
    if (++this.depth > this.maxDepth) this.error('Pattern nesting limit exceeded', position);
    let kind = 'capture';
    let name = null;
    let negative = false;
    let behind = false;
    if (this.pattern[this.offset] === '?') {
      this.offset++;
      const marker = this.pattern[this.offset++];
      if (marker === ':') kind = 'noncapture';
      else if (marker === '=' || marker === '!') { kind = 'look'; negative = marker === '!'; }
      else if (marker === '<') {
        const next = this.pattern[this.offset];
        if (next === '=' || next === '!') { kind = 'look'; negative = next === '!'; behind = true; this.offset++; }
        else {
          const end = this.pattern.indexOf('>', this.offset);
          if (end < 0) this.error('Unclosed capture name', position);
          name = this.pattern.slice(this.offset, end);
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) this.error('Invalid capture name', this.offset);
          if (Object.hasOwn(this.names, name)) this.error('Duplicate capture name', this.offset);
          this.offset = end + 1;
        }
      } else this.error('Unsupported group extension', position);
    }
    let group = 0;
    if (kind === 'capture') {
      group = ++this.groups;
      if (group > this.maxCaptures) this.error('Capture count limit exceeded', position);
      if (name) this.names[name] = group;
    }
    const child = this.alternation();
    if (this.pattern[this.offset++] !== ')') this.error('Unclosed group', position);
    this.depth--;
    return kind === 'noncapture' ? child : { kind, child, group, negative, behind, position };
  }
  quantified(child) {
    const position = this.offset;
    const marker = this.pattern[this.offset];
    let minimum;
    let maximum;
    if (marker === '*') { minimum = 0; maximum = Infinity; this.offset++; }
    else if (marker === '+') { minimum = 1; maximum = Infinity; this.offset++; }
    else if (marker === '?') { minimum = 0; maximum = 1; this.offset++; }
    else if (marker === '{') {
      this.offset++;
      minimum = this.integer();
      if (minimum === null) this.error('Invalid repetition', position);
      maximum = minimum;
      if (this.pattern[this.offset] === ',') { this.offset++; maximum = this.integer() ?? Infinity; }
      if (this.pattern[this.offset++] !== '}') this.error('Unclosed repetition', position);
      if (maximum < minimum) this.error('Repetition maximum precedes minimum', position);
      if (minimum > 10000 || maximum !== Infinity && maximum > 10000) this.error('Repetition exceeds 10000', position);
    } else return child;
    if (child.kind === 'anchor' || child.kind === 'look') this.error('Assertion cannot be quantified', position);
    const lazy = this.pattern[this.offset] === '?';
    if (lazy) this.offset++;
    return { kind: 'repeat', child, minimum, maximum, lazy, position };
  }
  integer() {
    const start = this.offset;
    while (/[0-9]/.test(this.pattern[this.offset] ?? '')) this.offset++;
    return start === this.offset ? null : Number(this.pattern.slice(start, this.offset));
  }
  characterClass(position) {
    const negative = this.pattern[this.offset] === '^';
    if (negative) this.offset++;
    const entries = [];
    while (this.offset < this.pattern.length && this.pattern[this.offset] !== ']') {
      const first = this.classAtom();
      if (this.pattern[this.offset] === '-' && this.pattern[this.offset + 1] !== ']') {
        this.offset++;
        const last = this.classAtom();
        if (first.kind !== 'literal' || last.kind !== 'literal') this.error('Invalid character-class range');
        if (first.value.codePointAt(0) > last.value.codePointAt(0)) this.error('Reversed character-class range');
        entries.push({ kind: 'range', first: first.value, last: last.value });
      } else entries.push(first);
    }
    if (this.pattern[this.offset++] !== ']') this.error('Unclosed character class', position);
    return { kind: 'class', entries, negative };
  }
  classAtom() {
    if (this.offset >= this.pattern.length) this.error('Unclosed character class');
    const position = this.offset;
    const character = String.fromCodePoint(this.pattern.codePointAt(this.offset));
    this.offset += character.length;
    return character === '\\' ? this.escape(true, position) : literal(character);
  }
  escape(inClass, position) {
    if (this.offset >= this.pattern.length) this.error('Trailing escape', position);
    const character = this.pattern[this.offset++];
    if (Object.hasOwn(CONTROL_ESCAPES, character)) return literal(CONTROL_ESCAPES[character]);
    if (['d', 'D', 's', 'S', 'w', 'W'].includes(character)) return { kind: 'builtin', value: character };
    if (character === 'b') return inClass ? literal('\b') : { kind: 'boundary', negative: false };
    if (character === 'B' && !inClass) return { kind: 'boundary', negative: true };
    if (character === 'p' || character === 'P') return this.property(character === 'P', position);
    if (character === 'x' || character === 'u') return literal(this.unicodeEscape(character, position));
    if (character === 'c') {
      const letter = this.pattern[this.offset++];
      if (!letter || !/[A-Za-z]/.test(letter)) this.error('Invalid control escape', position);
      return literal(String.fromCharCode(letter.toUpperCase().charCodeAt(0) % 32));
    }
    if (!inClass && /[1-9]/.test(character)) {
      this.offset--;
      return { kind: 'backref', group: this.integer(), position };
    }
    if (!inClass && character === 'k' && this.pattern[this.offset] === '<') {
      const end = this.pattern.indexOf('>', ++this.offset);
      if (end < 0) this.error('Unclosed named backreference', position);
      const name = this.pattern.slice(this.offset, end);
      this.offset = end + 1;
      return { kind: 'backref', name, position };
    }
    if (/[A-Za-z]/.test(character)) this.error('Unknown escape', position);
    return literal(character);
  }
  property(negative, position) {
    if (this.pattern[this.offset++] !== '{') this.error('Invalid Unicode property escape', position);
    const end = this.pattern.indexOf('}', this.offset);
    if (end < 0) this.error('Unclosed Unicode property escape', position);
    const value = this.pattern.slice(this.offset, end);
    if (!/^[A-Za-z_]+(?:=[A-Za-z_]+)?$/.test(value)) this.error('Invalid Unicode property name', position);
    this.offset = end + 1;
    return { kind: 'property', value, negative, position };
  }
  unicodeEscape(kind, position) {
    let digits;
    if (kind === 'u' && this.pattern[this.offset] === '{') {
      const end = this.pattern.indexOf('}', ++this.offset);
      if (end < 0) this.error('Unclosed Unicode escape', position);
      digits = this.pattern.slice(this.offset, end);
      this.offset = end + 1;
    } else {
      const count = kind === 'x' ? 2 : 4;
      digits = this.pattern.slice(this.offset, this.offset + count);
      if (digits.length !== count) this.error('Incomplete hexadecimal escape', position);
      this.offset += count;
    }
    if (!/^[0-9a-fA-F]{1,6}$/.test(digits) || parseInt(digits, 16) > 0x10ffff) this.error('Invalid Unicode escape', position);
    return String.fromCodePoint(parseInt(digits, 16));
  }
}
