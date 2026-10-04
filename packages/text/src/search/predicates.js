import { SearchPatternError } from './errors.js';

/** Unicode simple-fold canonicalization. Multi-code-point uppercase/lowercase expansions remain distinct. */
export function foldCharacter(character) {
  const code = character.charCodeAt(0);
  if (code < 128) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
  if (character === '\u0131') return character;
  const upper = character.toUpperCase();
  const lower = upper.toLowerCase();
  const scalar = value => value.length === 1 || value.length === 2 && value.codePointAt(0) > 0xffff;
  return scalar(upper) && scalar(lower) ? lower : character.toLowerCase();
}

export function isWord(character, matchCase = true) {
  if (!character) return false;
  return /^[A-Za-z0-9_]$/.test(matchCase ? character : foldCharacter(character));
}

function builtin(value, character, options) {
  const lower = value.toLowerCase();
  const positive = lower === 'd' ? /^[0-9]$/.test(character) : lower === 's' ? /^\s$/u.test(character) : isWord(character, options.matchCase);
  return value === lower ? positive : !positive;
}

function entryPredicate(node, options) {
  if (node.kind === 'literal') {
    const expected = options.matchCase ? node.value : foldCharacter(node.value);
    return character => (options.matchCase ? character : foldCharacter(character)) === expected;
  }
  if (node.kind === 'range') {
    const first = node.first.codePointAt(0).toString(16);
    const last = node.last.codePointAt(0).toString(16);
    // Exactly one character-class range: native Unicode case folding is bounded to one scalar.
    const predicate = new RegExp(`^[\\u{${first}}-\\u{${last}}]$`, options.matchCase ? 'u' : 'iu');
    return character => predicate.test(character);
  }
  if (node.kind === 'builtin') return character => builtin(node.value, character, options);
  if (node.kind === 'property') {
    let predicate;
    try {
      // This native regex contains exactly one validated property atom: no repetition, alternation, or backtracking.
      predicate = new RegExp(`^\\${node.negative ? 'P' : 'p'}{${node.value}}$`, 'u');
    } catch { throw new SearchPatternError('Unsupported Unicode property', node.position); }
    return character => predicate.test(character);
  }
  throw new TypeError(`Invalid predicate node: ${node.kind}`);
}

export function compilePredicate(node, options) {
  if (node.kind === 'any') return character => options.dotAll || !/[\r\n\u2028\u2029]/.test(character);
  if (node.kind !== 'class') return entryPredicate(node, options);
  const predicates = node.entries.map(entry => entryPredicate(entry, options));
  return character => predicates.some(predicate => predicate(character)) !== node.negative;
}
