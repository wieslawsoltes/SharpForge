import {PropertyFault} from '../../property/values.js';

export class CompiledBindingCompileError extends PropertyFault {
  constructor(code, message, position = 0) {
    super('ArgumentException', `${code}: ${message}`, {code, position});
    this.code = code;
    this.position = position;
  }
}

/** Parse the expression subset that can be represented by direct metadata-token accessors. */
export function parseCompiledBindingExpression(text, {maxLength = 16384, maxNodes = 4096, maxDepth = 32} = {}) {
  if (typeof text !== 'string' || text.length > maxLength) throw new CompiledBindingCompileError('SFXB002', 'Expression length exceeded');
  if (![maxLength, maxNodes, maxDepth].every(value => Number.isSafeInteger(value) && value > 0)
    || maxLength > 1000000 || maxNodes > 100000 || maxDepth > 64) throw new RangeError('Invalid expression budgets');
  const parser = new ExpressionParser(text, {maxNodes, maxDepth});
  const expression = parser.expression();
  parser.space();
  if (parser.offset !== text.length) parser.fail('Unexpected expression token');
  return expression;
}

class ExpressionParser {
  constructor(text, limits) { this.text = text; this.limits = limits; this.offset = 0; this.nodes = 0; this.depth = 0; }
  fail(message, position = this.offset) { throw new CompiledBindingCompileError('SFXB002', message, position); }
  space() { while (/\s/.test(this.text[this.offset] ?? '') && this.offset < this.text.length) this.offset++; }
  take(text) {
    this.space();
    if (!this.text.startsWith(text, this.offset)) return false;
    this.offset += text.length;
    return true;
  }
  node(kind, values, position) {
    if (++this.nodes > this.limits.maxNodes) this.fail('Expression node budget exceeded');
    return Object.freeze({kind, ...values, position});
  }
  identifier() {
    this.space();
    const match = /^[\p{L}_$][\p{L}\p{N}\p{M}_$]*(?::[\p{L}_$][\p{L}\p{N}\p{M}_$]*)?/u.exec(this.text.slice(this.offset));
    if (!match) this.fail('Expected an identifier');
    this.offset += match[0].length;
    return match[0];
  }
  expression() {
    if (++this.depth > this.limits.maxDepth) this.fail('Expression nesting exceeded');
    try {
      let value = this.primary();
      while (true) {
        const position = this.offset;
        const conditional = this.take('?.');
        if (conditional || this.take('.')) value = this.node('member', {receiver: value, name: this.identifier(), conditional}, position);
        else if (this.take('[')) {
          const argumentsList = this.arguments(']');
          if (argumentsList.length !== 1) this.fail('A supported indexer has exactly one index');
          value = this.node('index', {receiver: value, arguments: argumentsList}, position);
        } else if (this.take('(')) value = this.node('call', {method: value, arguments: this.arguments(')')}, position);
        else return value;
      }
    } finally { this.depth--; }
  }
  primary() {
    this.space();
    const position = this.offset;
    const character = this.text[this.offset];
    if (character === '"' || character === "'") return this.node('constant', {value: this.string()}, position);
    const number = /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.offset));
    if (number) {
      this.offset += number[0].length;
      const value = Number(number[0]);
      if (!Number.isFinite(value)) this.fail('A finite numeric constant is required', position);
      return this.node('constant', {value}, position);
    }
    if (this.take('(')) {
      const inner = this.expression();
      if (!this.take(')')) this.fail('Expected closing parenthesis');
      const type = qualifiedName(inner);
      this.space();
      if (type && /^[\p{L}_$(]/u.test(this.text[this.offset] ?? '')) {
        return this.node('cast', {type, value: this.expression()}, position);
      }
      return inner;
    }
    if (this.offset === this.text.length) return this.node('identifier', {name: 'this'}, position);
    const name = this.identifier();
    if (name === 'null' || name === 'true' || name === 'false') {
      return this.node('constant', {value: name === 'null' ? null : name === 'true'}, position);
    }
    return this.node('identifier', {name}, position);
  }
  arguments(end) {
    const values = [];
    if (this.take(end)) return Object.freeze(values);
    do {
      if (values.length >= 32) this.fail('Expression argument budget exceeded');
      values.push(this.expression());
      if (this.take(end)) return Object.freeze(values);
    } while (this.take(','));
    this.fail('Expected argument separator or closing delimiter');
  }
  string() {
    const quote = this.text[this.offset++];
    let value = '';
    while (this.offset < this.text.length) {
      let character = this.text[this.offset++];
      if (character === quote) return value;
      if (character === '\\') {
        character = this.text[this.offset++];
        const escaped = {n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'"};
        if (character === 'u') {
          const digits = this.text.slice(this.offset, this.offset + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail('Invalid Unicode escape');
          this.offset += 4;
          character = String.fromCharCode(Number.parseInt(digits, 16));
        } else if (Object.hasOwn(escaped, character)) character = escaped[character];
        else this.fail('Invalid string escape');
      }
      value += character;
    }
    this.fail('Unterminated string constant');
  }
}

export function qualifiedName(node) {
  if (node.kind === 'identifier') return node.name;
  if (node.kind === 'member' && !node.conditional) {
    const prefix = qualifiedName(node.receiver);
    return prefix ? prefix + '.' + node.name : null;
  }
  return null;
}
