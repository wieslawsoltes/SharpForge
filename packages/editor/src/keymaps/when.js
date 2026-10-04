const tokenPattern = /\s*(\&\&|\|\||===|!==|==|!=|!|\(|\)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-z_$][\w.$-]*|-?\d+(?:\.\d+)?)/gy;

/** Compiles bounded boolean context expressions without evaluating JavaScript. */
export function compileWhen(expression) {
  if (typeof expression === 'function') return expression;
  if (expression == null || expression === '') return () => true;
  if (typeof expression !== 'string' || expression.length > 2048) throw new TypeError('Invalid keybinding context');
  const tokens = [];
  let offset = 0;
  while (offset < expression.length) {
    if (!expression.slice(offset).trim()) break;
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(expression);
    if (!match) throw new SyntaxError(`Invalid context expression at ${offset}`);
    tokens.push(match[1]);
    offset = tokenPattern.lastIndex;
    if (tokens.length > 256) throw new RangeError('Keybinding context is too complex');
  }
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  function value(depth) {
    if (depth > 24) throw new RangeError('Keybinding context nesting exceeds 24');
    if (peek() === '!') { take(); const operand = value(depth + 1); return context => !operand(context); }
    if (peek() === '(') {
      take();
      const result = disjunction(depth + 1);
      if (take() !== ')') throw new SyntaxError('Missing closing context parenthesis');
      return result;
    }
    const token = take();
    if (!token || ['&&', '||', ')', '==', '!=', '===', '!=='].includes(token)) throw new SyntaxError('Expected context value');
    if (token === 'true' || token === 'false') return () => token === 'true';
    if (/^-?\d/.test(token)) return () => Number(token);
    if (token[0] === '"' || token[0] === "'") {
      const literal = token.slice(1, -1).replace(/\\(['"\\])/g, '$1');
      return () => literal;
    }
    return context => typeof context?.get === 'function' ? context.get(token) : context?.[token];
  }
  function comparison(depth) {
    const left = value(depth);
    if (!['==', '!=', '===', '!=='].includes(peek())) return left;
    const operator = take();
    const right = value(depth);
    return context => operator.startsWith('!') ? left(context) !== right(context) : left(context) === right(context);
  }
  function conjunction(depth) {
    const operands = [comparison(depth)];
    while (peek() === '&&') { take(); operands.push(comparison(depth)); }
    return context => operands.every(operand => !!operand(context));
  }
  function disjunction(depth) {
    const operands = [conjunction(depth)];
    while (peek() === '||') { take(); operands.push(conjunction(depth)); }
    return context => operands.some(operand => !!operand(context));
  }
  const evaluate = disjunction(0);
  if (position !== tokens.length) throw new SyntaxError('Unexpected context expression token');
  return evaluate;
}
