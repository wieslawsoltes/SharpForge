import {WorkbenchEvents, assertId} from './events.js';

/** Bounded expressions support identifiers, !, ==, !=, &&, || and parentheses; no evaluation of JavaScript. */
export function compileWhen(expression = '') {
  if (typeof expression !== 'string' || expression.length > 4096) throw new TypeError('Invalid when expression');
  if (!expression.trim()) return () => true;
  const tokens = [];
  const token = /\s*(&&|\|\||==|!=|!|\(|\)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.-]*)/y;
  let position = 0;
  while (position < expression.length) {
    token.lastIndex = position;
    const match = token.exec(expression);
    if (!match) {
      if (!expression.slice(position).trim()) break;
      throw new SyntaxError('Invalid when expression at ' + position);
    }
    tokens.push(match[1]);
    position = token.lastIndex;
  }
  let cursor = 0;
  let depth = 0;
  const primary = () => {
    if (++depth > 32) throw new RangeError('When expression nesting exceeds 32');
    const current = tokens[cursor++];
    let result;
    if (current === '!') {
      const operand = primary();
      result = context => !operand(context);
    } else if (current === '(') {
      result = disjunction();
      if (tokens[cursor++] !== ')') throw new SyntaxError('Unclosed when expression');
    } else if (/^[A-Za-z_][\w.-]*$/u.test(current ?? '')) {
      const operator = tokens[cursor];
      if (operator === '==' || operator === '!=') {
        cursor++;
        const value = tokens[cursor++];
        if (!value || ['&&', '||', ')'].includes(value)) throw new SyntaxError('Expected comparison value');
        const literal = value === 'true' ? true : value === 'false' ? false : value.replace(/^['"]|['"]$/g, '');
        result = context => operator === '==' ? context[current] === literal : context[current] !== literal;
      } else {
        result = context => current === 'true' || current !== 'false' && Boolean(context[current]);
      }
    } else throw new SyntaxError('Expected a context key');
    depth--;
    return result;
  };
  const conjunction = () => {
    let result = primary();
    while (tokens[cursor] === '&&') {
      cursor++;
      const left = result, right = primary();
      result = context => left(context) && right(context);
    }
    return result;
  };
  const disjunction = () => {
    let result = conjunction();
    while (tokens[cursor] === '||') {
      cursor++;
      const left = result, right = conjunction();
      result = context => left(context) || right(context);
    }
    return result;
  };
  const predicate = disjunction();
  if (cursor !== tokens.length) throw new SyntaxError('Unexpected when expression token ' + tokens[cursor]);
  return predicate;
}

export class ContextKeys extends WorkbenchEvents {
  constructor(initial = {}) {
    super();
    this.values = {...initial};
  }
  get(key) { return this.values[key]; }
  snapshot() { return {...this.values}; }
  set(key, value) {
    assertId(key, 'Context key');
    if (Object.is(this.values[key], value)) return;
    this.values[key] = value;
    this.emit({key, value, context: this.snapshot()});
  }
  update(values) {
    const changes = [];
    for (const [key, value] of Object.entries(values)) {
      assertId(key, 'Context key');
      if (Object.is(this.values[key], value)) continue;
      this.values[key] = value;
      changes.push({key, value});
    }
    if (changes.length) this.emit({changes, context: this.snapshot()});
  }
  matches(expression) { return compileWhen(expression)(this.values); }
}
