import { TemplateError } from '../common.js';

function tokenize(source) {
  if (typeof source !== 'string' || source.length > 16384) throw new TemplateError('SFTPL010', 'Template expression limit exceeded');
  const tokens = [];
  const pattern = /\s+|&&|\|\||==|!=|>=|<=|[!()<>+-]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[$A-Za-z_][$A-Za-z0-9_.-]*/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new TemplateError('SFTPL010', 'Unsupported template expression at offset ' + offset);
    offset = pattern.lastIndex;
    if (!/^\s/.test(match[0])) tokens.push(match[0]);
    if (tokens.length > 2048) throw new TemplateError('SFTPL010', 'Template expression token limit exceeded');
  }
  return tokens;
}

/** Bounded expression interpreter: no eval, property access, functions or process execution. */
export function evaluateTemplateExpression(source, resolve) {
  const tokens = tokenize(source);
  let position = 0;
  let depth = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  function primary() {
    if (++depth > 64) throw new TemplateError('SFTPL010', 'Template expression nesting limit exceeded');
    const token = take();
    let result;
    if (token === '(') {
      result = logicalOr();
      if (take() !== ')') throw new TemplateError('SFTPL010', 'Missing expression closing parenthesis');
    } else if (token === '!') result = !Boolean(primary());
    else if (token === '-') result = -Number(primary());
    else if (token === '+') result = Number(primary());
    else if (token?.toLowerCase() === 'true') result = true;
    else if (token?.toLowerCase() === 'false') result = false;
    else if (token === 'null') result = null;
    else if (token?.startsWith('"')) result = JSON.parse(token);
    else if (token?.startsWith("'")) result = token.slice(1, -1).replace(/\\(['\\])/g, '$1');
    else if (/^\d/.test(token ?? '')) result = Number(token);
    else if (/^[$A-Za-z_]/.test(token ?? '')) result = resolve(token);
    else throw new TemplateError('SFTPL010', 'Expected a value in template expression');
    depth--;
    return result;
  }
  function compare() {
    let value = primary();
    const operator = peek();
    if (!['==', '!=', '<', '<=', '>', '>='].includes(operator)) return value;
    take();
    const right = primary();
    const equal = value === null || right === null ? value === right : String(value).toLowerCase() === String(right).toLowerCase();
    if (operator === '==') value = equal;
    if (operator === '!=') value = !equal;
    if (operator === '<') value = value < right;
    if (operator === '<=') value = value <= right;
    if (operator === '>') value = value > right;
    if (operator === '>=') value = value >= right;
    return value;
  }
  function logicalAnd() {
    let value = compare();
    while (peek() === '&&' || peek()?.toLowerCase() === 'and') { take(); const right = compare(); value = Boolean(value) && Boolean(right); }
    return value;
  }
  function logicalOr() {
    let value = logicalAnd();
    while (peek() === '||' || peek()?.toLowerCase() === 'or') { take(); const right = logicalAnd(); value = Boolean(value) || Boolean(right); }
    return value;
  }
  const result = logicalOr();
  if (position !== tokens.length) throw new TemplateError('SFTPL010', 'Unexpected template expression token: ' + peek());
  return result;
}
