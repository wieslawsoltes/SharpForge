import { SearchLimitError } from './errors.js';
import { foldCharacter, isWord } from './predicates.js';

function previousCharacter(text, offset) {
  let start = offset - 1;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff && start > 0) {
    const high = text.charCodeAt(start - 1);
    if (high >= 0xd800 && high <= 0xdbff) start--;
  }
  return start < 0 ? '' : text.slice(start, offset);
}

function assertion(instruction, text, offset, options) {
  const previous = previousCharacter(text, offset);
  const next = offset < text.length ? String.fromCodePoint(text.codePointAt(offset)) : '';
  if (instruction.op === 'boundary') {
    const boundary = isWord(previous, options.matchCase) !== isWord(next, options.matchCase);
    return boundary !== instruction.negative;
  }
  if (instruction.value === '^') return offset === 0 || options.multiline && /[\r\n\u2028\u2029]/.test(previous);
  return offset === text.length || options.multiline && /[\r\n\u2028\u2029]/.test(next);
}

function rewind(text, offset, count, budget) {
  while (count-- > 0) {
    budget.tick();
    if (offset === 0) return -1;
    offset -= previousCharacter(text, offset).length;
  }
  return offset;
}

function backreference(instruction, captures, text, offset, options, budget) {
  let start = captures[instruction.group * 2];
  const end = captures[instruction.group * 2 + 1];
  if (start < 0 || end < start) return offset;
  while (start < end) {
    budget.tick();
    if (offset >= text.length) return -1;
    const expected = String.fromCodePoint(text.codePointAt(start));
    const actual = String.fromCodePoint(text.codePointAt(offset));
    const matches = options.matchCase ? expected === actual : foldCharacter(expected) === foldCharacter(actual);
    if (!matches) return -1;
    start += expected.length;
    offset += actual.length;
  }
  return offset;
}

/** Backtracking is explicit bytecode work: every transition is cancellable and charged to one shared budget. */
export function matchAt(program, text, start, budget, initialCaptures = null, depth = 0, expectedEnd = null) {
  if (depth > 64) throw new SearchLimitError('assertion depth', budget.steps);
  const code = program.code;
  const options = program.options;
  let captures = initialCaptures ? initialCaptures.slice() : new Int32Array(program.slots).fill(-1);
  const stack = [];
  let offset = start;
  let pointer = 0;
  while (true) {
    budget.tick();
    const instruction = code[pointer];
    let failed = false;
    if (instruction.op === 'character') {
      const character = offset < text.length ? String.fromCodePoint(text.codePointAt(offset)) : '';
      if (!character || !instruction.test(character)) failed = true;
      else { offset += character.length; pointer++; }
    } else if (instruction.op === 'save') { captures[instruction.slot] = offset; pointer++; }
    else if (instruction.op === 'jump') pointer = instruction.target;
    else if (instruction.op === 'split') {
      if (stack.length >= budget.maxStack || (stack.length + 1) * captures.byteLength > 32000000) {
        throw new SearchLimitError('backtracking stack', budget.steps);
      }
      stack.push({ pointer: instruction.second, offset, captures: captures.slice() });
      pointer = instruction.first;
    } else if (instruction.op === 'progress') {
      if (offset === captures[instruction.slot]) failed = true;
      else pointer = instruction.target;
    }
    else if (instruction.op === 'reset') {
      for (const group of instruction.captures) { captures[group * 2] = -1; captures[group * 2 + 1] = -1; }
      pointer++;
    } else if (instruction.op === 'anchor' || instruction.op === 'boundary') {
      failed = !assertion(instruction, text, offset, options);
      pointer++;
    } else if (instruction.op === 'backref') {
      const end = backreference(instruction, captures, text, offset, options, budget);
      if (end < 0) failed = true;
      else { offset = end; pointer++; }
    } else if (instruction.op === 'look') {
      const begin = instruction.behind ? rewind(text, offset, instruction.width, budget) : offset;
      const result = begin < 0 ? null : matchAt(
        { ...program, code: instruction.code }, text, begin, budget, captures, depth + 1, instruction.behind ? offset : null
      );
      failed = Boolean(result) === instruction.negative;
      if (!failed && result && !instruction.negative) captures = result.captures;
      pointer++;
    } else if (instruction.op === 'accept') {
      if (expectedEnd === null || offset === expectedEnd) return { start, end: offset, captures };
      failed = true;
    } else throw new Error(`Invalid regex instruction at ${pointer}`);
    if (!failed) continue;
    const state = stack.pop();
    if (!state) return null;
    pointer = state.pointer;
    offset = state.offset;
    captures = state.captures;
  }
}

/** Execute a global search. Empty matches advance by one Unicode scalar, including at document end. */
export function* regexMatches(program, text, budget) {
  let offset = 0;
  while (offset <= text.length) {
    budget.tick();
    const result = matchAt(program, text, offset, budget);
    if (result) {
      yield result;
      if (result.end > offset) { offset = result.end; continue; }
    }
    if (offset === text.length) return;
    offset += String.fromCodePoint(text.codePointAt(offset)).length;
  }
}
