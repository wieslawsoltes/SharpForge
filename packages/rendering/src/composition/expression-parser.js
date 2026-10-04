const precedence = Object.freeze({'||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6});
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'globalThis', 'window', 'eval', 'Function']);

function tokenize(source, maxTokens) {
  const tokens = [];
  const pattern = /\s+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|&&|\|\||==|!=|<=|>=|[+*/%(),.?:!<>-]/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError(`Invalid composition expression at ${offset}`);
    offset = pattern.lastIndex;
    if (/^\s/.test(match[0])) continue;
    if (tokens.length >= maxTokens) throw new RangeError('Composition expression token limit exceeded');
    tokens.push(match[0]);
  }
  return tokens;
}

/** Safe bounded expression AST; calls are identifiers in a fixed function table. */
export function parseCompositionExpression(source, {maxLength = 4096, maxTokens = 1024, maxDepth = 32} = {}) {
  if (typeof source !== 'string' || !source.length || source.length > maxLength) throw new SyntaxError('Invalid expression length');
  const tokens = tokenize(source, maxTokens);
  let position = 0;
  const take = value => {
    if (tokens[position] !== value) throw new SyntaxError(`Expected ${value} in composition expression`);
    position++;
  };
  const expression = (minimum = 0, depth = 0) => {
    if (depth > maxDepth) throw new RangeError('Composition expression nesting limit exceeded');
    let left = primary(depth + 1);
    while ((precedence[tokens[position]] ?? -1) >= minimum) {
      const operator = tokens[position++];
      left = {type: 'binary', operator, left, right: expression(precedence[operator] + 1, depth + 1)};
    }
    if (minimum === 0 && tokens[position] === '?') {
      position++;
      const yes = expression(0, depth + 1);
      take(':');
      left = {type: 'conditional', condition: left, yes, no: expression(0, depth + 1)};
    }
    return left;
  };
  const primary = depth => {
    const token = tokens[position++];
    let node;
    if (['+', '-', '!'].includes(token)) node = {type: 'unary', operator: token, operand: expression(7, depth + 1)};
    else if (token === '(') { node = expression(0, depth + 1); take(')'); }
    else if (token && /^(?:\d|\.\d)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new SyntaxError('Expression number is out of range');
      node = {type: 'literal', value};
    } else if (token && /^[A-Za-z_]\w*$/.test(token) && !forbidden.has(token)) {
      node = {type: 'reference', name: token};
      if (tokens[position] === '(') {
        position++;
        const args = [];
        while (tokens[position] !== ')') {
          if (args.length) take(',');
          if (args.length >= 16) throw new RangeError('Too many expression arguments');
          args.push(expression(0, depth + 1));
        }
        take(')');
        node = {type: 'call', name: token, args};
      }
    } else throw new SyntaxError(`Unexpected expression token: ${token ?? 'end'}`);
    while (tokens[position] === '.') {
      position++;
      const name = tokens[position++];
      if (!name || !/^[A-Za-z_]\w*$/.test(name) || forbidden.has(name)) throw new SyntaxError('Invalid expression member');
      node = {type: 'member', object: node, name};
    }
    return node;
  };
  const ast = expression();
  if (position !== tokens.length) throw new SyntaxError('Unexpected trailing composition expression');
  return ast;
}
