import { SearchBudget, SearchLimitError } from './errors.js';
import { RegexParser } from './parser.js';
import { compileRegex } from './compiler.js';
import { regexMatches } from './interpreter.js';
import { literalMatches } from './literal.js';
import { wholeWord } from './whole-word.js';

function positionScanner(text, budget) {
  let scanned = 0;
  let line = 0;
  let lineStart = 0;
  return start => {
    while (scanned < start) {
      budget.tick();
      const code = text.charCodeAt(scanned);
      if (code === 13 && text.charCodeAt(scanned + 1) === 10) {
        if (scanned + 2 > start) break;
        scanned += 2;
        lineStart = scanned;
        line++;
      } else {
        scanned++;
        if (code === 13 || code === 10) { lineStart = scanned; line++; }
      }
    }
    const preview = text.slice(lineStart, Math.min(text.length, lineStart + 240)).split(/\r\n|\r|\n/, 1)[0];
    return { line, character: start - lineStart, preview };
  };
}

function captureResult(raw, program, text) {
  if (!program) return { text: text.slice(raw.start, raw.end), captures: [], groups: undefined, indices: [{ start: raw.start, end: raw.end }] };
  const captures = [];
  const indices = [{ start: raw.start, end: raw.end }];
  for (let group = 1; group <= program.groups; group++) {
    const start = raw.captures[group * 2];
    const end = raw.captures[group * 2 + 1];
    captures.push(start < 0 || end < start ? undefined : text.slice(start, end));
    indices.push(start < 0 || end < start ? null : { start, end });
  }
  const groups = Object.fromEntries(Object.entries(program.names).map(([name, group]) => [name, captures[group - 1]]));
  return { text: text.slice(raw.start, raw.end), captures, groups, indices };
}

/**
 * Bounded literal/regex search. Offsets are UTF-16; line/character positions handle CR, LF and CRLF.
 * Patterns run in an instruction-counted interpreter, including lookarounds/backreferences; native backtracking is never used.
 */
export function findTextMatches(documents, query, options = {}) {
  if (typeof query !== 'string' || query.length > 1024) throw new RangeError('Search text must be a string of at most 1024 characters');
  const settings = { matchCase: false, wholeWord: false, regex: false, multiline: false, dotAll: false, maxMatches: 2000, ...options };
  if (!Number.isInteger(settings.maxMatches) || settings.maxMatches < 1 || settings.maxMatches > 10000) {
    throw new RangeError('Match limit must be between 1 and 10000');
  }
  const matches = [];
  let scannedFiles = 0;
  if (!query && !settings.regex) return { matches, truncated: false, scannedFiles };
  const budget = new SearchBudget(settings);
  const program = settings.regex ? compileRegex(new RegexParser(query, settings).parse(), settings, budget) : null;
  const resultLimit = settings.maxResultCharacters ?? 16000000;
  let resultCharacters = 0;
  for (const document of documents) {
    budget.check();
    const { uri, text, version } = document;
    if (typeof text !== 'string' || typeof uri !== 'string') throw new TypeError('Search documents require URI and text');
    scannedFiles++;
    const locate = positionScanner(text, budget);
    const iterator = program ? regexMatches(program, text, budget) : literalMatches(text, query, settings, budget);
    for (const raw of iterator) {
      if (settings.wholeWord && !wholeWord(text, raw)) continue;
      if (matches.length === settings.maxMatches) return { matches, truncated: true, scannedFiles };
      resultCharacters += raw.end - raw.start;
      if (resultCharacters > resultLimit) throw new SearchLimitError('result size', budget.steps);
      matches.push({ uri, start: raw.start, end: raw.end, version, ...locate(raw.start), ...captureResult(raw, program, text) });
    }
  }
  return { matches, truncated: false, scannedFiles };
}
