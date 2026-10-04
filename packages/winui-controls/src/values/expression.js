import { ControlError } from '../policy/events.js';

/** Bounded Pratt parser: numeric arithmetic only, with no JavaScript execution or property access. */
export function evaluateNumericExpression(source, { maximumTokens = 512, maximumDepth = 32 } = {}) {
  if (typeof source !== 'string' || source.length > 8192) throw new ControlError('SFUI1684', 'Numeric expression is too long');
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([+\-*/%^()]))/y;
  let offset = 0;
  while (offset < source.length) {
    if (!source.slice(offset).trim()) break;
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new ControlError('SFUI1684', 'Invalid numeric expression token');
    tokens.push(match[3] ?? Number(match[1] + (match[2] ?? '')));
    offset = pattern.lastIndex;
    if (tokens.length > maximumTokens) throw new ControlError('SFUI1684', 'Numeric expression token limit exceeded');
  }
  let cursor = 0;
  const binding = { '+': 10, '-': 10, '*': 20, '/': 20, '%': 20, '^': 30 };
  function parse(minimum, depth) {
    if (depth > maximumDepth) throw new ControlError('SFUI1684', 'Numeric expression nesting limit exceeded');
    const token = tokens[cursor++];
    let left;
    if (typeof token === 'number') left = token;
    else if (token === '+' || token === '-') left = (token === '-' ? -1 : 1) * parse(25, depth + 1);
    else if (token === '(') {
      left = parse(0, depth + 1);
      if (tokens[cursor++] !== ')') throw new ControlError('SFUI1684', 'Unclosed numeric expression group');
    } else throw new ControlError('SFUI1684', 'A number was expected');
    while ((binding[tokens[cursor]] ?? -1) >= minimum) {
      const operator = tokens[cursor++];
      const right = parse(binding[operator] + (operator === '^' ? 0 : 1), depth + 1);
      if (operator === '+') left += right;
      else if (operator === '-') left -= right;
      else if (operator === '*') left *= right;
      else if (operator === '/') left /= right;
      else if (operator === '%') left %= right;
      else left **= right;
      if (!Number.isFinite(left)) throw new ControlError('SFUI1684', 'Numeric expression is not finite');
    }
    return left;
  }
  const result = parse(0, 0);
  if (cursor !== tokens.length) throw new ControlError('SFUI1684', 'Unexpected numeric expression suffix');
  if (!Number.isFinite(result)) throw new ControlError('SFUI1684', 'Numeric expression is not finite');
  return result;
}
