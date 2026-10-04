import { expandExpression } from './evaluation/expander.js';
import { referenceStart, scanReference } from './evaluation/expression-scanner.js';
import { EvaluationError, toBoolean } from './evaluation/errors.js';

function tokenize(text) {
  const tokens = [];
  let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset])) {
      offset++;
      continue;
    }
    const start = offset;
    const operator = /^(==|!=|<=|>=|[<>()!,])/.exec(text.slice(offset));
    if (operator) {
      tokens.push({ type: operator[0], start });
      offset += operator[0].length;
      continue;
    }
    const quote = ['"', "'"].includes(text[offset]) ? text[offset++] : '';
    const first = offset;
    while (offset < text.length) {
      if (referenceStart(text, offset)) offset = scanReference(text, offset).end;
      else if (quote ? text[offset] === quote : /[\s<>=!(),]/.test(text[offset])) break;
      else offset++;
    }
    if (quote && text[offset] !== quote) throw new EvaluationError('Unterminated condition string.', 'MSB4092', { start });
    if (!quote && first === offset) throw new EvaluationError('Invalid condition token.', 'MSB4092', { start });
    const value = text.slice(first, offset);
    if (quote) offset++;
    const word = value.toLowerCase();
    tokens.push({ type: !quote && ['and', 'or', 'exists', 'hastrailingslash'].includes(word) ? word : 'value', value, start });
    if (tokens.length > 8192) throw new EvaluationError('Condition token limit exceeded.', 'MSB4092');
  }
  return tokens;
}

function compare(left, right, equality) {
  const numeric = value => /^(?:[-+]?\d+(?:\.\d+)?|0x[\da-f]+)$/i.test(value) ? Number(value) : NaN;
  const first = numeric(left);
  const second = numeric(right);
  if (Number.isFinite(first) && Number.isFinite(second)) return first < second ? -1 : first > second ? 1 : 0;
  if (/^\d+(?:\.\d+){1,3}$/.test(left) && /^\d+(?:\.\d+){1,3}$/.test(right)) {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < 4; index++) {
      const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (difference) return difference < 0 ? -1 : 1;
    }
    return 0;
  }
  if (equality) return left.toLowerCase() === right.toLowerCase() ? 0 : 1;
  throw new EvaluationError('Relational conditions require numeric or version operands.', 'MSB4086');
}

/** Parse first, expand operands second. Expanded quotes/operators never become condition syntax. */
export function evaluateCondition(text, options = {}) {
  if (!text?.trim()) return true;
  if (text.length > 16384) throw new EvaluationError('Condition text limit exceeded.', 'MSB4092');
  const context = options.context ?? options;
  const tokens = tokenize(text);
  let position = 0;
  let depth = 0;
  const take = type => {
    if (tokens[position]?.type !== type) return false;
    position++;
    return true;
  };
  const fail = message => {
    throw new EvaluationError(message, 'MSB4092', { start: tokens[position]?.start ?? text.length });
  };
  const operand = active => {
    const token = tokens[position++];
    if (token?.type !== 'value') fail('Expected a condition value.');
    return active ? expandExpression(token.value, context) : '';
  };
  function atom(active) {
    if (++depth > 64) fail('Condition nesting limit exceeded.');
    let result;
    if (take('!')) result = !atom(active);
    else if (take('(')) {
      result = or(active);
      if (!take(')')) fail('Missing condition closing parenthesis.');
    } else if (['exists', 'hastrailingslash'].includes(tokens[position]?.type)) {
      const method = tokens[position++].type;
      if (!take('(')) fail('Missing condition function opening parenthesis.');
      const value = operand(active);
      if (!take(')')) fail('Missing condition function closing parenthesis.');
      result = active && (method === 'exists' ? (context.exists ?? (() => false))(value) : /[\\/]$/.test(value));
    } else {
      const left = operand(active);
      const operator = tokens[position]?.type;
      if (['==', '!=', '<', '>', '<=', '>='].includes(operator)) {
        position++;
        const right = operand(active);
        const order = active ? compare(left, right, operator === '==' || operator === '!=') : 0;
        const comparisons = { '==': order === 0, '!=': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 };
        result = comparisons[operator];
      } else result = active ? toBoolean(left) : false;
    }
    depth--;
    return result;
  }
  function and(active) {
    let value = atom(active);
    while (take('and')) {
      const right = atom(active && value);
      value = value && right;
    }
    return value;
  }
  function or(active) {
    let value = and(active);
    while (take('or')) {
      const right = and(active && !value);
      value = value || right;
    }
    return value;
  }
  const result = or(true);
  if (position !== tokens.length) fail('Unsupported condition suffix.');
  return result;
}
