import {lex} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {csharpValue} from './codegen.js';
import {failSource} from './source-errors.js';

function regularString(value) {
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function stringLiteral(original, value) {
  if (original.startsWith('@"')) return '@"' + value.replaceAll('"', '""') + '"';
  const delimiter = original.match(/^"{3,}/)?.[0];
  if (!delimiter) return regularString(value);
  const quoteRuns = value.match(/"+/g) ?? [];
  const width = Math.max(delimiter.length, 3, ...quoteRuns.map(run => run.length + 1));
  const quotes = '"'.repeat(width);
  const multiline = original.includes('\n') || value.includes('\n') || value.includes('\r');
  if (!multiline) return quotes + value + quotes;
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const closing = original.slice(0, -delimiter.length).match(/(?:\r?\n)([ \t]*)$/)?.[1] ?? '';
  return quotes + newline + value.split(/\r\n|\n|\r/).map(line => closing + line).join(newline) + newline + closing + quotes;
}

function groupedDigits(digits, original) {
  if (!original.includes('_')) return digits;
  const groups = original.split('_');
  const width = groups.at(-1).length;
  if (!width) return digits;
  const parts = [];
  for (let end = digits.length; end > 0; end -= width) parts.unshift(digits.slice(Math.max(0, end - width), end));
  return parts.join('_');
}

function numberLiteral(original, value, type) {
  if (!Number.isFinite(value)) failSource('A finite C# numeric literal is required', null, 'SFSYNC_DYNAMIC');
  const radix = original.match(/^(0[xXbB])([0-9a-fA-F_]+?)([uUlL]*)$/);
  if (radix && Number.isSafeInteger(value) && value >= 0) {
    let digits = value.toString(radix[1][1].toLowerCase() === 'x' ? 16 : 2);
    if (/[A-F]/.test(radix[2])) digits = digits.toUpperCase();
    return radix[1] + groupedDigits(digits, radix[2]) + radix[3];
  }
  const number = original.match(/^([0-9_]+)(?:\.([0-9_]*))?(?:([eE])([+-]?)([0-9_]+))?([uUlLfFdDmM]*)$/);
  if (!number) return csharpValue(value, type);
  const suffix = number[6] ?? '';
  if (/[uUlL]/.test(suffix) && !Number.isSafeInteger(value)) failSource('Integer literal cannot represent this value', null, 'SFSYNC_DYNAMIC');
  if (number[3]) {
    const [mantissa, exponent] = value.toExponential().split('e');
    const sign = exponent.startsWith('-') ? '-' : number[4] === '+' ? '+' : '';
    return mantissa + number[3] + sign + exponent.replace(/^[+-]/, '') + suffix;
  }
  const [integer, fraction] = String(value).split('.');
  const head = groupedDigits(integer, number[1]);
  if (fraction !== undefined) return head + '.' + fraction + suffix;
  return head + (number[2] !== undefined ? '.' + '0'.repeat(Math.max(1, number[2].replaceAll('_', '').length)) : '') + suffix;
}

/** Minimal literal token replacement; non-literal value objects use the registered source emitter. */
export function sourceLiteralEdit(text, expression, value, type) {
  const source = text.slice(expression.start, expression.end);
  const tokens = lex(new SourceText(source)).tokens.filter(token => token.kind !== 'eof');
  if (typeof value === 'number' && tokens.length === 2 && ['-', '+'].includes(tokens[0].kind)
    && ['integer', 'double'].includes(tokens[1].kind)) {
    const numeric = tokens[1];
    const negative = tokens[0].kind === '-';
    if ((value < 0) === negative || value === 0) {
      return {start: expression.start + numeric.start, end: expression.start + numeric.end,
        text: numberLiteral(numeric.text, Math.abs(value), type)};
    }
  }
  if (tokens.length === 1) {
    const token = tokens[0];
    const start = expression.start + token.start;
    const end = expression.start + token.end;
    if (typeof value === 'string' && token.kind === 'string') return {start, end, text: stringLiteral(token.text, value)};
    if (typeof value === 'number' && ['integer', 'double'].includes(token.kind)) return {start, end, text: numberLiteral(token.text, value, type)};
    if (value === null || typeof value === 'boolean') return {start, end, text: csharpValue(value, type)};
  }
  const comments = tokens.some(token => /\/\/|\/\*/.test(token.green.leading));
  if (comments) failSource('Replacing this composite value would remove expression trivia; edit it in Code view', expression, 'SFSYNC_DYNAMIC');
  return {start: expression.start, end: expression.end, text: csharpValue(value, type)};
}
