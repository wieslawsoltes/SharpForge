import { scanReal } from './reals.js';
/** Integer literal scanning with C# type selection (int, uint, long, ulong) on exact BigInt values. */
export const integerLimits = Object.freeze({ int: 0x7fffffffn, uint: 0xffffffffn, long: 0x7fffffffffffffffn, ulong: 0xffffffffffffffffn });
const candidates = { '': ['int', 'uint', 'long', 'ulong'], u: ['uint', 'ulong'], l: ['long', 'ulong'], ul: ['ulong'] };
/** Picks the first type of the C# candidate list that can represent `value`; null when it exceeds ulong. */
export function integerType(value, suffix = '') {
  const key = /u/i.test(suffix) ? (/l/i.test(suffix) ? 'ul' : 'u') : /l/i.test(suffix) ? 'l' : '';
  return candidates[key].find(type => value <= integerLimits[type]) ?? null;
}
/**
 * Scans a numeric literal starting at a digit. Returns
 * { end, kind: 'integer' | 'double', value (legacy Number), literal: { type, value }, suffix, errors, features, profile }.
 * `profile` lists diagnostics for literal forms the current SharpForge back end cannot consume; the scanner itself accepts them.
 */
export function scanNumber(text, start) {
  const errors = [],
    features = [],
    profile = [];
  let i = start;
  const prefix = text[i] === '0' ? (text[i + 1] ?? '').toLowerCase() : '';
  let digits,
    radix = 10;
  if (prefix === 'x' || prefix === 'b') {
    radix = prefix === 'x' ? 16 : 2;
    i += 2;
    const from = i,
      digit = radix === 16 ? /[\da-fA-F_]/ : /[01_]/;
    while (digit.test(text[i] ?? '')) i++;
    digits = text.slice(from, i);
    if (radix === 2) features.push('BinaryLiteral');
    if (digits.startsWith('_')) features.push('LeadingDigitSeparator');
  } else {
    while (/[\d_]/.test(text[i] ?? '')) i++;
    const next = text[i] ?? '',
      after = text[i + 1] ?? '';
    if (
      (next === '.' && /\d/.test(after)) ||
      (/[eE]/.test(next) && (/\d/.test(after) || (/[+-]/.test(after) && /\d/.test(text[i + 2] ?? '')))) ||
      /[fFdDmM]/.test(next)
    )
      return scanReal(text, start);
    digits = text.slice(start, i);
  }
  if (digits.includes('_')) features.push('DigitSeparator');
  const clean = digits.replaceAll('_', '');
  if (!clean || digits.endsWith('_')) errors.push({ code: 'CS1013', message: 'Invalid number' });
  const suffix = /^(?:[uU][lL]?|[lL][uU]?)/.exec(text.slice(i, i + 2))?.[0] ?? '';
  i += suffix.length;
  const value = clean ? BigInt((radix === 16 ? '0x' : radix === 2 ? '0b' : '') + clean) : 0n;
  let type = integerType(value, suffix);
  if (!type) {
    errors.push({ code: 'CS1021', message: 'Integral constant is too large' });
    type = 'ulong';
  }
  const legacy = clean ? Number(value) : NaN;
  if (suffix) profile.push({ code: 'SF1003', message: 'decimal, long and unsigned literals are not implemented' });
  else if (legacy > 2147483648) profile.push({ code: 'SF1004', message: 'This profile supports signed 32-bit integer literals' });
  return {
    end: i,
    kind: 'integer',
    value: legacy,
    literal: { type, value: type === 'int' || type === 'uint' ? Number(value) : value },
    suffix,
    errors,
    features,
    profile
  };
}
